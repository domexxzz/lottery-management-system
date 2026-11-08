import { Prisma, type BillStatus, type SettlementStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";
import { orgScope, requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { sumMoney, ZERO } from "@/lib/money";

const COUNTED_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];
const SETTLEMENT_STATUSES: SettlementStatus[] = ["DRAFT", "RECONCILED", "APPROVED"];

export type AgentReportView = "summary" | "prizes" | "bills" | "settlements";
export type AgentSettlementFilter = "ALL" | "PENDING" | SettlementStatus;

export type AgentReportFilter = {
  drawId?: string;
  dateFrom?: string;
  dateTo?: string;
  settlement?: string;
  view?: string;
};

export type AgentRoundReportRow = {
  drawId: string;
  drawName: string;
  cutoffAt: Date;
  drawStatus: string;
  billCount: number;
  itemCount: number;
  winnerCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal | null;
  net: Prisma.Decimal | null;
  settlementStatus: SettlementStatus | "PENDING";
};

function parseStart(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(`${value}T00:00:00+07:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function parseEnd(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(`${value}T23:59:59.999+07:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function settlementFilter(value?: string): AgentSettlementFilter {
  if (value === "PENDING" || SETTLEMENT_STATUSES.includes(value as SettlementStatus)) return value as AgentSettlementFilter;
  return "ALL";
}

function reportView(value?: string): AgentReportView {
  return value === "prizes" || value === "bills" || value === "settlements" ? value : "summary";
}

function applySettlementFilter(rows: AgentRoundReportRow[], filter: AgentSettlementFilter) {
  if (filter === "ALL") return rows;
  return rows.filter((row) => row.settlementStatus === filter);
}

function totalRows(rows: AgentRoundReportRow[]) {
  return {
    billCount: rows.reduce((sum, row) => sum + row.billCount, 0),
    itemCount: rows.reduce((sum, row) => sum + row.itemCount, 0),
    winnerCount: rows.reduce((sum, row) => sum + row.winnerCount, 0),
    gross: sumMoney(rows.map((row) => row.gross)),
    payout: sumMoney(rows.map((row) => row.payout)),
    commission: sumMoney(rows.map((row) => row.commission ?? ZERO)),
    net: sumMoney(rows.map((row) => row.net ?? ZERO)),
    settledCount: rows.filter((row) => row.settlementStatus !== "PENDING").length,
    pendingCount: rows.filter((row) => row.settlementStatus === "PENDING").length,
  };
}

export async function getAgentReport(actor: Actor, filter: AgentReportFilter) {
  requirePermission(actor, "bill.viewOwn");
  if (actor.role !== "AGENT" || !actor.agentId) throw new ForbiddenError("รายงานนี้สำหรับ Agent เท่านั้น");

  const scope = orgScope(actor);
  const agentId = actor.agentId;
  const dateFrom = parseStart(filter.dateFrom);
  const dateTo = parseEnd(filter.dateTo);
  const selectedSettlement = settlementFilter(filter.settlement);
  const selectedView = reportView(filter.view);

  const agent = await prisma.agent.findFirst({
    where: { ...scope, id: agentId },
    select: { code: true, name: true },
  });
  if (!agent) throw new ForbiddenError("ไม่พบบัญชี Agent");

  async function loadRows(where: Prisma.DrawWhereInput) {
    const draws = await prisma.draw.findMany({
      where,
      orderBy: { cutoffAt: "desc" },
      take: 50,
      select: { id: true, name: true, cutoffAt: true, status: true },
    });
    const drawIds = draws.map((draw) => draw.id);
    if (drawIds.length === 0) return [] as AgentRoundReportRow[];

    const [bills, settlements] = await Promise.all([
      prisma.bill.findMany({
        where: { ...scope, agentId, drawId: { in: drawIds }, status: { in: COUNTED_STATUSES } },
        select: { drawId: true, totalStake: true, totalPayout: true, items: { select: { isWinner: true } } },
      }),
      prisma.settlement.findMany({
        where: { ...scope, agentId, drawId: { in: drawIds } },
        select: { drawId: true, commission: true, net: true, status: true },
      }),
    ]);

    const billBuckets = new Map<string, { count: number; items: number; winners: number; gross: Prisma.Decimal[]; payout: Prisma.Decimal[] }>();
    for (const bill of bills) {
      const bucket = billBuckets.get(bill.drawId) ?? { count: 0, items: 0, winners: 0, gross: [], payout: [] };
      bucket.count += 1;
      bucket.items += bill.items.length;
      bucket.winners += bill.items.filter((item) => item.isWinner).length;
      bucket.gross.push(bill.totalStake);
      bucket.payout.push(bill.totalPayout);
      billBuckets.set(bill.drawId, bucket);
    }
    const settlementByDraw = new Map(settlements.map((settlement) => [settlement.drawId, settlement]));

    return draws.map((draw): AgentRoundReportRow => {
      const billsForDraw = billBuckets.get(draw.id);
      const settlement = settlementByDraw.get(draw.id);
      return {
        drawId: draw.id,
        drawName: draw.name,
        cutoffAt: draw.cutoffAt,
        drawStatus: draw.status,
        billCount: billsForDraw?.count ?? 0,
        itemCount: billsForDraw?.items ?? 0,
        winnerCount: billsForDraw?.winners ?? 0,
        gross: sumMoney(billsForDraw?.gross ?? []),
        payout: sumMoney(billsForDraw?.payout ?? []),
        commission: settlement?.commission ?? null,
        net: settlement?.net ?? null,
        settlementStatus: settlement?.status ?? "PENDING",
      };
    });
  }

  const drawWhere: Prisma.DrawWhereInput = {
    ...scope,
    ...(filter.drawId ? { id: filter.drawId } : {}),
    ...((dateFrom || dateTo) ? { cutoffAt: { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) } } : {}),
  };
  const rows = applySettlementFilter(await loadRows(drawWhere), selectedSettlement);
  const totals = totalRows(rows);

  let previousTotals: ReturnType<typeof totalRows> | null = null;
  if (dateFrom && dateTo && dateTo >= dateFrom && !filter.drawId) {
    const duration = dateTo.getTime() - dateFrom.getTime() + 1;
    const previousEnd = new Date(dateFrom.getTime() - 1);
    const previousStart = new Date(previousEnd.getTime() - duration + 1);
    const previousRows = applySettlementFilter(await loadRows({ ...scope, cutoffAt: { gte: previousStart, lte: previousEnd } }), selectedSettlement);
    previousTotals = totalRows(previousRows);
  }

  const includedDrawIds = rows.map((row) => row.drawId);
  const [prizeItems, bills] = await Promise.all([
    selectedView === "prizes" && includedDrawIds.length
      ? prisma.billItem.findMany({
          where: { bill: { ...scope, agentId, drawId: { in: includedDrawIds }, status: { in: COUNTED_STATUSES } } },
          select: { stake: true, payout: true, isWinner: true, prizeType: { select: { code: true, name: true } } },
        })
      : Promise.resolve([]),
    selectedView === "bills" && includedDrawIds.length
      ? prisma.bill.findMany({
          where: { ...scope, agentId, drawId: { in: includedDrawIds }, status: { in: COUNTED_STATUSES } },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { id: true, billNumber: true, title: true, status: true, totalStake: true, totalPayout: true, createdAt: true, draw: { select: { name: true } }, _count: { select: { items: true } } },
        })
      : Promise.resolve([]),
  ]);

  const prizeBuckets = new Map<number, { code: number; name: string; count: number; winners: number; gross: Prisma.Decimal[]; payout: Prisma.Decimal[] }>();
  for (const item of prizeItems) {
    const bucket = prizeBuckets.get(item.prizeType.code) ?? { code: item.prizeType.code, name: item.prizeType.name, count: 0, winners: 0, gross: [], payout: [] };
    bucket.count += 1;
    if (item.isWinner) bucket.winners += 1;
    bucket.gross.push(item.stake);
    bucket.payout.push(item.payout);
    prizeBuckets.set(item.prizeType.code, bucket);
  }
  const prizes = [...prizeBuckets.values()].map((bucket) => ({ ...bucket, gross: sumMoney(bucket.gross), payout: sumMoney(bucket.payout) })).sort((a, b) => a.code - b.code);

  const allDraws = await prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, take: 50, select: { id: true, name: true } });

  return {
    agent,
    rows,
    totals,
    previousTotals,
    prizes,
    bills,
    settlements: rows.filter((row) => row.settlementStatus !== "PENDING"),
    draws: allDraws,
    selectedSettlement,
    selectedView,
    dateFrom: filter.dateFrom ?? "",
    dateTo: filter.dateTo ?? "",
    selectedDrawId: filter.drawId ?? "",
  };
}

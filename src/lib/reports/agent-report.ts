import { Prisma, type BillStatus, type SettlementStatus } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";
import { orgScope, requirePermission } from "@/lib/auth/context";
import { databaseSchema, prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { sumMoney, ZERO } from "@/lib/money";
import { commissionRateForLottery } from "@/lib/agents/commission";
import { resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { drawDay, inRange, parseDay } from "@/lib/draws/range";

const COUNTED_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];
const SETTLEMENT_STATUSES: SettlementStatus[] = ["DRAFT", "RECONCILED", "APPROVED"];

export type AgentReportView = "summary" | "prizes" | "bills" | "winners" | "settlements";
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

export type SimpleAgentRound = {
  drawId: string;
  drawName: string;
  cutoffAt: Date;
  billCount: number;
  winnerCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  commissionFinal: boolean;
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
  return value === "prizes" || value === "bills" || value === "winners" || value === "settlements" ? value : "summary";
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

  function table(name: "bills" | "bill_items") {
    return Prisma.raw(`"${databaseSchema().replaceAll('"', '""')}"."${name}"`);
  }

  /**
   * ยอดต่องวดของ Agent รายนี้ รวมในฐานข้อมูล
   * เดิมดึงบิลทุกใบพร้อมรายการเลขทุกรายการมานับใน Node.js
   */
  async function loadRows(where: Prisma.DrawWhereInput) {
    const draws = await prisma.draw.findMany({
      where,
      orderBy: { cutoffAt: "desc" },
      take: 50,
      select: { id: true, name: true, cutoffAt: true, status: true },
    });
    const drawIds = draws.map((draw) => draw.id);
    if (drawIds.length === 0) return [] as AgentRoundReportRow[];

    const [billTotals, itemTotals, settlements] = await Promise.all([
      prisma.bill.groupBy({
        by: ["drawId"],
        where: { ...scope, agentId, drawId: { in: drawIds }, status: { in: COUNTED_STATUSES } },
        _count: { _all: true },
        _sum: { totalStake: true, totalPayout: true },
      }),
      prisma.$queryRaw<Array<{ drawId: string; items: number; winners: number }>>(Prisma.sql`
        SELECT b."drawId", COUNT(i.id)::int AS items, COUNT(i.id) FILTER (WHERE i."isWinner")::int AS winners
        FROM ${table("bill_items")} i
        JOIN ${table("bills")} b ON b.id = i."billId"
        WHERE b."organizationId" = ${actor.organizationId}
          AND b."agentId" = ${agentId}
          AND b."drawId" IN (${Prisma.join(drawIds)})
          AND b.status::text IN (${Prisma.join(COUNTED_STATUSES)})
        GROUP BY b."drawId"
      `),
      prisma.settlement.findMany({
        where: { ...scope, agentId, drawId: { in: drawIds } },
        select: { drawId: true, commission: true, net: true, status: true },
      }),
    ]);

    const billByDraw = new Map(billTotals.map((row) => [row.drawId, row]));
    const itemsByDraw = new Map(itemTotals.map((row) => [row.drawId, row]));
    const settlementByDraw = new Map(settlements.map((settlement) => [settlement.drawId, settlement]));

    return draws.map((draw): AgentRoundReportRow => {
      const billRow = billByDraw.get(draw.id);
      const itemRow = itemsByDraw.get(draw.id);
      const settlement = settlementByDraw.get(draw.id);
      return {
        drawId: draw.id,
        drawName: draw.name,
        cutoffAt: draw.cutoffAt,
        drawStatus: draw.status,
        billCount: billRow?._count._all ?? 0,
        itemCount: itemRow?.items ?? 0,
        winnerCount: itemRow?.winners ?? 0,
        gross: billRow?._sum.totalStake ?? ZERO,
        payout: billRow?._sum.totalPayout ?? ZERO,
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
  const hasPrevious = Boolean(dateFrom && dateTo && dateTo >= dateFrom && !filter.drawId);
  const previousRange = hasPrevious && dateFrom && dateTo
    ? (() => {
        const duration = dateTo.getTime() - dateFrom.getTime() + 1;
        const previousEnd = new Date(dateFrom.getTime() - 1);
        return { gte: new Date(previousEnd.getTime() - duration + 1), lte: previousEnd };
      })()
    : null;

  // คิวรีที่ไม่ขึ้นต่อกันรันพร้อมกัน เดิมรอทีละตัว 5–7 รอบ
  const [agent, currentRows, previousRows, allDraws] = await Promise.all([
    prisma.agent.findFirst({ where: { ...scope, id: agentId }, select: { code: true, name: true } }),
    loadRows(drawWhere),
    previousRange ? loadRows({ ...scope, cutoffAt: previousRange }) : Promise.resolve(null),
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, take: 50, select: { id: true, name: true } }),
  ]);
  if (!agent) throw new ForbiddenError("ไม่พบบัญชี Agent");

  const rows = applySettlementFilter(currentRows, selectedSettlement);
  const totals = totalRows(rows);
  const previousTotals = previousRows ? totalRows(applySettlementFilter(previousRows, selectedSettlement)) : null;

  const includedDrawIds = rows.map((row) => row.drawId);
  const countedBillFilter = { ...scope, agentId, drawId: { in: includedDrawIds }, status: { in: COUNTED_STATUSES } };
  const wantsPrizes = selectedView === "prizes" && includedDrawIds.length > 0;
  const [prizeTotals, prizeWinners, prizeTypes, bills] = await Promise.all([
    wantsPrizes
      ? prisma.billItem.groupBy({ by: ["prizeTypeId"], where: { bill: countedBillFilter }, _count: { _all: true }, _sum: { stake: true, payout: true } })
      : Promise.resolve([]),
    wantsPrizes
      ? prisma.billItem.groupBy({ by: ["prizeTypeId"], where: { bill: countedBillFilter, isWinner: true }, _count: { _all: true } })
      : Promise.resolve([]),
    wantsPrizes ? prisma.prizeType.findMany({ where: scope, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
    (selectedView === "bills" || selectedView === "winners") && includedDrawIds.length
      ? prisma.bill.findMany({
          where: {
            ...countedBillFilter,
            ...(selectedView === "winners" ? { totalPayout: { gt: 0 } } : {}),
          },
          orderBy: { createdAt: "desc" },
          take: 200,
          select: { id: true, drawSequence: true, title: true, status: true, totalStake: true, totalPayout: true, createdAt: true, draw: { select: { name: true } }, _count: { select: { items: true } } },
        })
      : Promise.resolve([]),
  ]);

  const prizeTypeById = new Map(prizeTypes.map((prizeType) => [prizeType.id, prizeType]));
  const winnersByPrize = new Map(prizeWinners.map((row) => [row.prizeTypeId, row._count._all]));
  const prizes = prizeTotals
    .map((row) => {
      const prizeType = prizeTypeById.get(row.prizeTypeId);
      return {
        code: prizeType?.code ?? 0,
        name: prizeType?.name ?? "-",
        count: row._count._all,
        winners: winnersByPrize.get(row.prizeTypeId) ?? 0,
        gross: row._sum.stake ?? ZERO,
        payout: row._sum.payout ?? ZERO,
      };
    })
    .sort((a, b) => a.code - b.code);


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

/** รายงาน Agent ตามประเภท งวด และวันออกรางวัล โดยรวมเฉพาะบิลของ Agent ที่ยืนยันแล้ว */
export type SimpleAgentBillFilter = "ALL" | "WON" | "LOST" | "PENDING";

export async function getSimpleAgentReport(actor: Actor, selectedDrawId?: string, billStatus: SimpleAgentBillFilter = "ALL", requestedPage = 1, options: { lottery?: string; dateFrom?: string; dateTo?: string } = {}) {
  requirePermission(actor, "bill.viewOwn");
  if (actor.role !== "AGENT" || !actor.agentId) throw new ForbiddenError("รายงานนี้สำหรับ Agent เท่านั้น");

  const scope = orgScope(actor);
  const [agent, drawOptions] = await Promise.all([
    prisma.agent.findFirst({
      where: { ...scope, id: actor.agentId },
      select: { code: true, name: true, commissionRate: true, laoCommissionRate: true },
    }),
    prisma.draw.findMany({
      where: scope,
      orderBy: { cutoffAt: "desc" },
      select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true, laoFamilyId: true },
    }),
  ]);
  if (!agent) throw new ForbiddenError("ไม่พบบัญชี Agent");

  const drawScope = resolveDashboardDrawScope(drawOptions, options.lottery, selectedDrawId);
  const dateFrom = parseDay(options.dateFrom);
  const dateTo = parseDay(options.dateTo);
  const allowedIds = drawScope.drawIds ? new Set(drawScope.drawIds) : null;
  const draws = drawOptions.filter((draw) => (!allowedIds || allowedIds.has(draw.id)) && inRange(drawDay(draw), dateFrom, dateTo));
  const drawIds = draws.map((draw) => draw.id);
  if (drawIds.length === 0) return {
    agent, rounds: [] as SimpleAgentRound[], winners: [], drawOptions, drawScope,
    selectedDrawId: drawScope.selectedDraw?.id ?? "",
    totals: { gross: ZERO, payout: ZERO, commission: ZERO, commissionFinal: true },
    billHistory: { rows: [], counts: { all: 0, won: 0, lost: 0, pending: 0 }, page: 1, pages: 1, status: billStatus },
  };

  const billFilter = {
    ...scope,
    agentId: actor.agentId,
    drawId: { in: drawIds },
    status: { in: COUNTED_STATUSES },
  } satisfies Prisma.BillWhereInput;
  const schema = databaseSchema().replaceAll('"', '""');
  const billsTable = Prisma.raw(`"${schema}"."bills"`);
  const itemsTable = Prisma.raw(`"${schema}"."bill_items"`);

  const [billTotals, winnerTotals, settlements, winners] = await Promise.all([
    prisma.bill.groupBy({
      by: ["drawId"],
      where: billFilter,
      _count: { _all: true },
      _sum: { totalStake: true, totalPayout: true },
    }),
    prisma.$queryRaw<Array<{ drawId: string; winners: number }>>(Prisma.sql`
      SELECT b."drawId", COUNT(i.id) FILTER (WHERE i."isWinner")::int AS winners
      FROM ${itemsTable} i
      JOIN ${billsTable} b ON b.id = i."billId"
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."agentId" = ${actor.agentId}
        AND b."drawId" IN (${Prisma.join(drawIds)})
        AND b.status::text IN (${Prisma.join(COUNTED_STATUSES)})
      GROUP BY b."drawId"
    `),
    prisma.settlement.findMany({
      where: { ...scope, agentId: actor.agentId, drawId: { in: drawIds } },
      select: { drawId: true, commission: true },
    }),
    prisma.bill.findMany({
      where: { ...billFilter, totalPayout: { gt: 0 } },
      orderBy: [{ totalPayout: "desc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        id: true,
        drawSequence: true,
        title: true,
        totalStake: true,
        totalPayout: true,
        createdAt: true,
        draw: { select: { id: true, name: true } },
      },
    }),
  ]);

  const billsByDraw = new Map(billTotals.map((row) => [row.drawId, row]));
  const winnersByDraw = new Map(winnerTotals.map((row) => [row.drawId, row.winners]));
  const settlementByDraw = new Map(settlements.map((row) => [row.drawId, row]));
  const rounds = draws.map((draw): SimpleAgentRound => {
    const bill = billsByDraw.get(draw.id);
    const gross = bill?._sum.totalStake ?? ZERO;
    const settlement = settlementByDraw.get(draw.id);
    return {
      drawId: draw.id,
      drawName: draw.name,
      cutoffAt: draw.cutoffAt,
      billCount: bill?._count._all ?? 0,
      winnerCount: winnersByDraw.get(draw.id) ?? 0,
      gross,
      payout: bill?._sum.totalPayout ?? ZERO,
      commission: settlement?.commission ?? gross.times(commissionRateForLottery(agent, draw.lotteryType)).dividedBy(100),
      commissionFinal: Boolean(settlement),
    };
  });

  const totals = {
    gross: sumMoney(rounds.map((round) => round.gross)),
    payout: sumMoney(rounds.map((round) => round.payout)),
    commission: sumMoney(rounds.map((round) => round.commission)),
    commissionFinal: rounds.every((round) => round.commissionFinal || round.billCount === 0),
  };
  const selectedBills = { ...scope, agentId: actor.agentId, drawId: { in: drawIds } } satisfies Prisma.BillWhereInput;
  const won = { ...selectedBills, status: "SETTLED", totalPayout: { gt: 0 } } satisfies Prisma.BillWhereInput;
  const lost = { ...selectedBills, status: "SETTLED", totalPayout: { lte: 0 } } satisfies Prisma.BillWhereInput;
  const pending = { ...selectedBills, status: { in: ["CONFIRMED", "LOCKED"] } } satisfies Prisma.BillWhereInput;
  const selectedFilter = billStatus === "WON" ? won : billStatus === "LOST" ? lost : billStatus === "PENDING" ? pending : { ...selectedBills, status: { in: COUNTED_STATUSES } };
  const [allCount, wonCount, lostCount, pendingCount] = await Promise.all([
    prisma.bill.count({ where: { ...selectedBills, status: { in: COUNTED_STATUSES } } }),
    prisma.bill.count({ where: won }),
    prisma.bill.count({ where: lost }),
    prisma.bill.count({ where: pending }),
  ]);
  const selectedCount = billStatus === "WON" ? wonCount : billStatus === "LOST" ? lostCount : billStatus === "PENDING" ? pendingCount : allCount;
  const pages = Math.max(1, Math.ceil(selectedCount / 20));
  const page = Math.min(Math.max(Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1, 1), pages);
  const historyRows = await prisma.bill.findMany({
    where: selectedFilter,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * 20,
    take: 20,
    select: { id: true, drawSequence: true, title: true, status: true, totalStake: true, totalPayout: true, createdAt: true, draw: { select: { name: true, drawDate: true, cutoffAt: true, lotteryType: true } } },
  });

  return { agent, rounds, winners, drawOptions, drawScope, selectedDrawId: drawScope.selectedDraw?.id ?? "", totals, billHistory: { rows: historyRows, counts: { all: allCount, won: wonCount, lost: lostCount, pending: pendingCount }, page, pages, status: billStatus } };
}

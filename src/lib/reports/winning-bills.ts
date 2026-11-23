import { Prisma, type LotteryType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { commissionRateForLottery } from "@/lib/agents/commission";
import { commissionOf } from "@/lib/money";
import type { WinningBillsQuery } from "./winning-bills-query";

export const WINNER_REPORT_PAGE_SIZE = 50;

function lotteryTypes(query: WinningBillsQuery): LotteryType[] | undefined {
  if (query.lottery === "THAI_GOVERNMENT") return ["THAI_GOVERNMENT"];
  if (query.lottery === "LAO_COMBINED") return ["LAO", "LAO_SET"];
  return undefined;
}

const number = (value: Prisma.Decimal | number | null | undefined) => Number(value ?? 0);

/** รายงานบิลที่ถูกรางวัลสำหรับ Owner/Admin ใช้ตัวกรองเดียวกับการ์ดหน้าภาพรวม */
export async function loadWinningBillsReport(actor: Actor, query: WinningBillsQuery) {
  requirePermission(actor, "report.viewAllAgents");
  const types = lotteryTypes(query);
  const where: Prisma.BillWhereInput = {
    ...orgScope(actor),
    status: "SETTLED",
    totalPayout: { gt: 0 },
    ...(query.agentId ? { agentId: query.agentId } : {}),
    ...(query.drawIds.length > 0 ? { drawId: { in: query.drawIds } } : {}),
    ...(types ? { draw: { lotteryType: { in: types } } } : {}),
    ...(query.dateFrom || query.dateTo ? { createdAt: { ...(query.dateFrom ? { gte: query.dateFrom } : {}), ...(query.dateTo ? { lte: query.dateTo } : {}) } } : {}),
  };

  const [groups, totalBills] = await Promise.all([
    prisma.bill.groupBy({
      by: ["agentId", "drawId"],
      where,
      _count: { _all: true },
      _sum: { totalStake: true, totalPayout: true },
    }),
    prisma.bill.count({ where }),
  ]);

  const pageCount = Math.max(1, Math.ceil(totalBills / WINNER_REPORT_PAGE_SIZE));
  const page = Math.min(query.page, pageCount);
  const bills = totalBills === 0 ? [] : await prisma.bill.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * WINNER_REPORT_PAGE_SIZE,
    take: WINNER_REPORT_PAGE_SIZE,
    select: {
      id: true,
      drawSequence: true,
      title: true,
      totalStake: true,
      totalPayout: true,
      createdAt: true,
      agentId: true,
      drawId: true,
      agent: { select: { code: true, name: true, commissionRate: true, laoCommissionRate: true } },
      draw: { select: { name: true, drawDate: true, lotteryType: true } },
      items: {
        where: { OR: [{ isWinner: true }, { winningPrizes: { some: { isPaid: true } } }] },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          number: true,
          stake: true,
          packagePrice: true,
          quantity: true,
          payout: true,
          prizeType: { select: { name: true } },
          winningPrizes: {
            where: { isPaid: true },
            orderBy: [{ payout: "desc" }, { id: "asc" }],
            select: { prizeLabelSnapshot: true, payout: true },
          },
        },
      },
    },
  });

  const agentIds = [...new Set(groups.map((row) => row.agentId))];
  const drawIds = [...new Set(groups.map((row) => row.drawId))];
  const [agents, draws, settlements] = groups.length === 0 ? [[], [], []] : await Promise.all([
    prisma.agent.findMany({
      where: { ...orgScope(actor), id: { in: agentIds } },
      select: { id: true, code: true, name: true, commissionRate: true, laoCommissionRate: true },
    }),
    prisma.draw.findMany({
      where: { ...orgScope(actor), id: { in: drawIds } },
      select: { id: true, lotteryType: true },
    }),
    prisma.settlement.findMany({
      where: { ...orgScope(actor), agentId: { in: agentIds }, drawId: { in: drawIds } },
      select: { agentId: true, drawId: true, commissionRateSnapshot: true },
    }),
  ]);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const drawById = new Map(draws.map((draw) => [draw.id, draw]));
  const rateByKey = new Map(settlements.map((row) => [`${row.agentId}:${row.drawId}`, row.commissionRateSnapshot]));
  const rateFor = (agentId: string, drawId: string) => {
    const settled = rateByKey.get(`${agentId}:${drawId}`);
    if (settled) return settled;
    const agent = agentById.get(agentId);
    const draw = drawById.get(drawId);
    return agent && draw ? commissionRateForLottery(agent, draw.lotteryType) : new Prisma.Decimal(0);
  };

  const summaryByAgent = new Map<string, { agentId: string; code: string; name: string; billCount: number; gross: number; payout: number; commission: number }>();
  for (const row of groups) {
    const agent = agentById.get(row.agentId);
    if (!agent) continue;
    const gross = number(row._sum.totalStake);
    const payout = number(row._sum.totalPayout);
    const commission = number(commissionOf({ gross: new Prisma.Decimal(gross), payout: new Prisma.Decimal(payout), commissionRatePercent: rateFor(row.agentId, row.drawId) }));
    const current = summaryByAgent.get(row.agentId) ?? { agentId: row.agentId, code: agent.code, name: agent.name, billCount: 0, gross: 0, payout: 0, commission: 0 };
    current.billCount += row._count._all;
    current.gross += gross;
    current.payout += payout;
    current.commission += commission;
    summaryByAgent.set(row.agentId, current);
  }
  const agentSummaries = [...summaryByAgent.values()].sort((a, b) => b.payout - a.payout || a.code.localeCompare(b.code));

  const detail = bills.map((bill) => {
    const rate = rateFor(bill.agentId, bill.drawId);
    const commission = number(commissionOf({ gross: bill.totalStake, payout: bill.totalPayout, commissionRatePercent: rate }));
    return {
      ...bill,
      commissionRate: number(rate),
      commission,
      prizes: bill.items.flatMap((item) => item.winningPrizes.length > 0
        ? item.winningPrizes.map((prize) => ({ itemId: item.id, number: item.number, label: prize.prizeLabelSnapshot, payout: number(prize.payout), stake: number(item.stake), packagePrice: item.packagePrice ? number(item.packagePrice) : null, quantity: item.quantity }))
        : [{ itemId: item.id, number: item.number, label: item.prizeType.name, payout: number(item.payout), stake: number(item.stake), packagePrice: item.packagePrice ? number(item.packagePrice) : null, quantity: item.quantity }]),
    };
  });
  const detailsByAgent = new Map<string, typeof detail>();
  for (const bill of detail) {
    const rows = detailsByAgent.get(bill.agentId) ?? [];
    rows.push(bill);
    detailsByAgent.set(bill.agentId, rows);
  }

  return {
    page,
    pageCount,
    pageSize: WINNER_REPORT_PAGE_SIZE,
    totalBills,
    totals: {
      gross: agentSummaries.reduce((sum, row) => sum + row.gross, 0),
      payout: agentSummaries.reduce((sum, row) => sum + row.payout, 0),
      commission: agentSummaries.reduce((sum, row) => sum + row.commission, 0),
    },
    agents: agentSummaries.map((agent) => ({ ...agent, bills: detailsByAgent.get(agent.agentId) ?? [] })),
  };
}

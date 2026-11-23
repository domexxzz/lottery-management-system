import type { BillStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgScope, type Actor } from "@/lib/auth/context";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";
import { commissionRateForLottery } from "@/lib/agents/commission";

/**
 * ข้อมูลหน้าภาพรวมของ Owner/Admin
 *
 * เดิมหน้านี้ดึงบิลทุกใบขององค์กร (พร้อม Agent และจำนวนรายการ) มาวนรวมยอดใน Node.js
 * ราว 900 KB ต่อ request ที่ 2,000 บิล และโตตามจำนวนบิลตรง ๆ
 * ตอนนี้ให้ PostgreSQL รวมยอดและจัดกลุ่ม แล้วส่งกลับมาเฉพาะตัวเลขสรุปกับรายการสั้น ๆ
 */

export type DashboardFilter = { drawId?: string; lottery?: string; agentId?: string; status?: string; dateFrom?: string; dateTo?: string };

export const BILL_STATUSES: BillStatus[] = ["DRAFT", "CONFIRMED", "LOCKED", "SETTLED", "CANCELLED"];
/** บิลที่มีผลผูกพันทางเงิน ใช้ชุดเดียวกับหน้ารายงาน */
export const COUNTED_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];

const THAI_SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** key/label ของวันตามเวลาไทยแบบคงที่ ให้ HTML จาก server กับ client ตรงกันทุก locale */
export function bangkokDay(date: Date): { key: string; label: string } {
  const shifted = new Date(date.getTime() + BANGKOK_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  return {
    key: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    label: `${day} ${THAI_SHORT_MONTHS[month]}`,
  };
}

/** เวลาเที่ยงคืนตามเวลาไทยของวันที่ date ตกอยู่ */
function bangkokMidnight(date: Date): Date {
  const shifted = date.getTime() + BANGKOK_OFFSET_MS;
  return new Date(shifted - (shifted % DAY_MS) - BANGKOK_OFFSET_MS);
}

function num(value: Prisma.Decimal | number | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

export async function loadManagementDashboard(actor: Actor, filters: DashboardFilter) {
  const scope = orgScope(actor);

  const parsedFrom = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00+07:00`) : undefined;
  const parsedTo = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999+07:00`) : undefined;
  const validFrom = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : undefined;
  const validTo = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : undefined;
  const selectedStatus = BILL_STATUSES.includes(filters.status as BillStatus) ? (filters.status as BillStatus) : undefined;
  const physicalDraws = await prisma.draw.findMany({
    where: scope,
    orderBy: { cutoffAt: "desc" },
    select: { id: true, name: true, drawDate: true, status: true, cutoffAt: true, lotteryType: true, laoFamilyId: true },
  });
  const drawScope = resolveDashboardDrawScope(physicalDraws, filters.lottery, filters.drawId);
  const drawWhere: Prisma.BillWhereInput = drawScope.drawIds === undefined
    ? {}
    : { drawId: { in: drawScope.drawIds } };

  /** บิลทุกสถานะตามตัวกรอง ใช้กับรายการบิลล่าสุด */
  const listWhere: Prisma.BillWhereInput = {
    ...scope,
    ...drawWhere,
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(selectedStatus ? { status: selectedStatus } : {}),
    ...(validFrom || validTo ? { createdAt: { ...(validFrom ? { gte: validFrom } : {}), ...(validTo ? { lte: validTo } : {}) } } : {}),
  };
  /**
   * บิลที่นำมาคิดยอดเงิน: ถ้าไม่ได้เลือกสถานะ นับเฉพาะบิลที่มีผลผูกพัน
   * เดิมนับบิลร่างและบิลที่ลบแล้วรวมเข้าไปในยอดขายด้วย ซึ่งไม่ตรงกับหน้ารายงาน
   */
  const moneyWhere: Prisma.BillWhereInput = selectedStatus
    ? COUNTED_STATUSES.includes(selectedStatus)
      ? listWhere
      : { ...listWhere, status: { in: [] } }
    : { ...listWhere, status: { in: COUNTED_STATUSES } };

  /** การ์ดผลบิลนับเฉพาะบิลที่ตรวจผลแล้ว เพื่อไม่ตีความบิลที่ยังรอผลเป็นบิลไม่ถูก */
  const settledWhere: Prisma.BillWhereInput = selectedStatus === undefined || selectedStatus === "SETTLED"
    ? { ...listWhere, status: "SETTLED" }
    : { ...listWhere, status: { in: [] } };

  const [totals, itemCount, perAgentDraw, recentBills, winnerTitles, awaitingClose, pendingCancellations, anomalyCount, activeAgents, settlementByDraw, settlementByAgent, winningGroups, losingGroups, settlementRates] = await Promise.all([
    prisma.bill.aggregate({ where: moneyWhere, _count: { _all: true }, _sum: { totalStake: true, totalPayout: true } }),
    prisma.billItem.count({ where: { bill: moneyWhere } }),
    prisma.bill.groupBy({ by: ["agentId", "drawId"], where: moneyWhere, _count: { _all: true }, _sum: { totalStake: true } }),
    prisma.bill.findMany({
      where: listWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      select: { id: true, drawSequence: true, title: true, status: true, totalStake: true, createdAt: true, agent: { select: { code: true, name: true } } },
    }),
    prisma.bill.groupBy({ by: ["title"], where: { ...moneyWhere, totalPayout: { gt: 0 } }, _count: { _all: true } }),
    prisma.draw.count({ where: { ...scope, status: "SETTLED", ...(drawScope.drawIds === undefined ? {} : { id: { in: drawScope.drawIds } }) } }),
    prisma.bill.count({ where: { ...listWhere, cancelRequestedAt: { not: null }, cancelledAt: null } }),
    prisma.settlement.count({ where: { ...scope, net: { lt: 0 }, ...(drawScope.drawIds === undefined ? {} : { drawId: { in: drawScope.drawIds } }), ...(filters.agentId ? { agentId: filters.agentId } : {}) } }),
    prisma.agent.count({ where: { ...scope, status: "ACTIVE" } }),
    prisma.settlement.groupBy({
      by: ["drawId"],
      where: { ...scope, ...(drawScope.drawIds === undefined ? {} : { drawId: { in: drawScope.drawIds } }), ...(filters.agentId ? { agentId: filters.agentId } : {}) },
      _sum: { gross: true, payout: true, commission: true, net: true },
    }),
    prisma.settlement.groupBy({
      by: ["agentId"],
      where: { ...scope, ...(drawScope.drawIds === undefined ? {} : { drawId: { in: drawScope.drawIds } }), ...(filters.agentId ? { agentId: filters.agentId } : {}) },
      _sum: { gross: true, payout: true, commission: true, net: true },
    }),
    prisma.bill.groupBy({
      by: ["agentId", "drawId"],
      where: { ...settledWhere, totalPayout: { gt: 0 } },
      _count: { _all: true },
      _sum: { totalStake: true, totalPayout: true },
    }),
    prisma.bill.groupBy({
      by: ["agentId", "drawId"],
      where: { ...settledWhere, totalPayout: { lte: 0 } },
      _count: { _all: true },
      _sum: { totalStake: true, totalPayout: true },
    }),
    prisma.settlement.findMany({
      where: { ...scope, ...(drawScope.drawIds === undefined ? {} : { drawId: { in: drawScope.drawIds } }), ...(filters.agentId ? { agentId: filters.agentId } : {}) },
      select: { drawId: true, agentId: true, commissionRateSnapshot: true },
    }),
  ]);

  // งวดปัจจุบัน: งวดที่เลือก หรืองวดล่าสุดที่ยังไม่ปิด หรืองวดล่าสุด — ใช้รายการงวดที่ดึงมาแล้ว ไม่ query ซ้ำ
  const currentDraw = drawScope.selectedDraw
    ?? drawScope.logicalDraws.find((draw) => (draw.category === drawScope.category || drawScope.category === "ALL") && ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED"].includes(draw.status))
    ?? drawScope.logicalDraws.find((draw) => draw.category === drawScope.category || drawScope.category === "ALL")
    ?? drawScope.logicalDraws[0]
    ?? null;

  const agentIds = [...new Set([
    ...perAgentDraw.map((row) => row.agentId),
    ...settlementByAgent.map((row) => row.agentId),
    ...winningGroups.map((row) => row.agentId),
    ...losingGroups.map((row) => row.agentId),
  ])];
  const agents = agentIds.length === 0 ? [] : await prisma.agent.findMany({
    where: { ...scope, id: { in: agentIds } },
    select: { id: true, code: true, name: true, commissionRate: true, laoCommissionRate: true },
  });
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  const gross = num(totals._sum.totalStake);
  const payout = num(totals._sum.totalPayout);
  const physicalDrawById = new Map(physicalDraws.map((draw) => [draw.id, draw]));
  // งวดที่ยังไม่ Settlement ประมาณค่าคอมแยกตามประเภทหวยของแต่ละงวด
  const commission = perAgentDraw.reduce((sum, row) => {
    const agent = agentById.get(row.agentId);
    const draw = physicalDrawById.get(row.drawId);
    if (!agent || !draw) return sum;
    return sum + num(row._sum.totalStake) * Number(commissionRateForLottery(agent, draw.lotteryType)) / 100;
  }, 0);
  // ลูกค้าที่ถูกรางวัล นับตามชื่อที่ตัดช่องว่างและไม่สนตัวพิมพ์ บิลที่ไม่มีชื่อนับแยกทีละใบ
  const winnerKeys = new Set<string>();
  let unnamedWinners = 0;
  for (const row of winnerTitles) {
    const key = row.title.trim().toLocaleLowerCase("th-TH");
    if (key) winnerKeys.add(key);
    else unnamedWinners += row._count._all;
  }
  const summary = {
    gross,
    payout,
    commission,
    net: gross - payout - commission,
    billCount: totals._count._all,
    itemCount,
    winnerCount: winnerKeys.size + unnamedWinners,
  };

  const settledRateByAgentDraw = new Map(settlementRates.map((row) => [`${row.agentId}:${row.drawId}`, Number(row.commissionRateSnapshot)]));
  const outcome = (rows: typeof winningGroups) => {
    let billCount = 0;
    let outcomeGross = 0;
    let outcomePayout = 0;
    let outcomeCommission = 0;
    for (const row of rows) {
      const rowGross = num(row._sum.totalStake);
      const agent = agentById.get(row.agentId);
      const draw = physicalDrawById.get(row.drawId);
      const rate = settledRateByAgentDraw.get(`${row.agentId}:${row.drawId}`)
        ?? (agent && draw ? Number(commissionRateForLottery(agent, draw.lotteryType)) : 0);
      billCount += row._count._all;
      outcomeGross += rowGross;
      outcomePayout += num(row._sum.totalPayout);
      outcomeCommission += rowGross * rate / 100;
    }
    const roundedCommission = Math.round(outcomeCommission * 100) / 100;
    return {
      billCount,
      gross: outcomeGross,
      payout: outcomePayout,
      commission: roundedCommission,
      net: outcomeGross - outcomePayout - roundedCommission,
    };
  };
  const winning = outcome(winningGroups);
  const losing = outcome(losingGroups);
  const businessBreakdown = {
    winning,
    losing,
    settled: {
      billCount: winning.billCount + losing.billCount,
      gross: winning.gross + losing.gross,
      payout: winning.payout + losing.payout,
      commission: winning.commission + losing.commission,
      net: winning.net + losing.net,
    },
    pendingBillCount: Math.max(0, summary.billCount - winning.billCount - losing.billCount),
  };

  // แนวโน้ม 7 วัน ดึงเฉพาะบิลในช่วง 7 วันนั้น ไม่ใช่ทุกบิล
  const latestCounted = await prisma.bill.findFirst({ where: moneyWhere, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  const chartEnd = validTo ?? latestCounted?.createdAt ?? currentDraw?.cutoffAt ?? new Date(0);
  const windowStart = bangkokMidnight(new Date(chartEnd.getTime() - 6 * DAY_MS));
  const windowEnd = new Date(bangkokMidnight(chartEnd).getTime() + DAY_MS - 1);
  const windowBills = await prisma.bill.findMany({
    where: { AND: [moneyWhere, { createdAt: { gte: windowStart, lte: windowEnd } }] },
    select: { createdAt: true, totalStake: true },
  });
  const salesByDay = new Map<string, number>();
  const billsByDay = new Map<string, number>();
  for (const bill of windowBills) {
    const { key } = bangkokDay(bill.createdAt);
    salesByDay.set(key, (salesByDay.get(key) ?? 0) + Number(bill.totalStake));
    billsByDay.set(key, (billsByDay.get(key) ?? 0) + 1);
  }
  const salesTrend = Array.from({ length: 7 }, (_, index) => {
    const { key, label } = bangkokDay(new Date(chartEnd.getTime() - (6 - index) * DAY_MS));
    return { key, label, value: salesByDay.get(key) ?? 0, bills: billsByDay.get(key) ?? 0 };
  });

  const rankingByAgent = new Map<string, { gross: number; billCount: number }>();
  for (const row of perAgentDraw) {
    const current = rankingByAgent.get(row.agentId) ?? { gross: 0, billCount: 0 };
    current.gross += num(row._sum.totalStake);
    current.billCount += row._count._all;
    rankingByAgent.set(row.agentId, current);
  }
  const rankedAgents = [...rankingByAgent]
    .map(([agentId, totals]) => ({
      agentCode: agentById.get(agentId)?.code ?? "-",
      agentName: agentById.get(agentId)?.name ?? "-",
      gross: totals.gross,
      billCount: totals.billCount,
    }))
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 5);

  const settlementByDrawId = new Map(settlementByDraw.map((row) => [row.drawId, row._sum]));
  const drawFinance = drawScope.logicalDraws
    .filter((draw) => drawScope.drawIds === undefined || draw.memberIds.some((id) => drawScope.drawIds?.includes(id)))
    .map((draw) => {
      const sums = draw.memberIds.map((id) => settlementByDrawId.get(id));
      return {
        id: draw.id,
        label: `${reportCategoryLabel(draw.category)} · ${dashboardDrawLabel(draw)}`,
        gross: sums.reduce((sum, row) => sum + num(row?.gross), 0),
        payout: sums.reduce((sum, row) => sum + num(row?.payout), 0),
        commission: sums.reduce((sum, row) => sum + num(row?.commission), 0),
        net: sums.reduce((sum, row) => sum + num(row?.net), 0),
      };
    })
    .filter((row) => row.gross !== 0 || row.payout !== 0 || row.commission !== 0 || row.net !== 0)
    .slice(0, 4);
  const agentFinance = settlementByAgent
    .map((row) => {
      const agent = agentById.get(row.agentId);
      return { agentId: row.agentId, label: agent ? `${agent.code} ${agent.name}` : "-", gross: num(row._sum.gross), payout: num(row._sum.payout), commission: num(row._sum.commission), net: num(row._sum.net) };
    })
    // หน้าภาพรวมแสดงเฉพาะ Top 5 ตามยอดขาย ที่เหลือดูได้ที่หน้าภาพรวม Agent
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 5);

  return {
    selectedStatus,
    currentDraw,
    lotteryCategory: drawScope.category,
    selectedDrawId: drawScope.selectedDraw?.id,
    selectedPhysicalDrawIds: drawScope.selectedDraw?.memberIds ?? [],
    drawOptions: drawScope.logicalDraws.map((draw) => ({
      id: draw.id,
      name: `${reportCategoryLabel(draw.category)} · ${dashboardDrawLabel(draw)}`,
      status: draw.status,
      lotteryType: draw.lotteryType,
      category: draw.category,
    })),
    summary,
    businessBreakdown,
    recentBills,
    salesTrend,
    rankedAgents,
    drawFinance,
    agentFinance,
    awaitingClose,
    pendingCancellations,
    anomalyCount,
    activeAgents,
    validTo,
  };
}

import type { BillStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { orgScope, type Actor } from "@/lib/auth/context";

/**
 * ข้อมูลหน้าภาพรวมของ Owner/Admin/Godmode
 *
 * เดิมหน้านี้ดึงบิลทุกใบขององค์กร (พร้อม Agent และจำนวนรายการ) มาวนรวมยอดใน Node.js
 * ราว 900 KB ต่อ request ที่ 2,000 บิล และโตตามจำนวนบิลตรง ๆ
 * ตอนนี้ให้ PostgreSQL รวมยอดและจัดกลุ่ม แล้วส่งกลับมาเฉพาะตัวเลขสรุปกับรายการสั้น ๆ
 */

export type DashboardFilter = { drawId?: string; agentId?: string; status?: string; dateFrom?: string; dateTo?: string };

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
  const drawSelect = { id: true, name: true, status: true, opensAt: true, cutoffAt: true } as const;

  const parsedFrom = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00+07:00`) : undefined;
  const parsedTo = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999+07:00`) : undefined;
  const validFrom = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : undefined;
  const validTo = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : undefined;
  const selectedStatus = BILL_STATUSES.includes(filters.status as BillStatus) ? (filters.status as BillStatus) : undefined;

  /** บิลทุกสถานะตามตัวกรอง ใช้กับรายการบิลล่าสุด */
  const listWhere: Prisma.BillWhereInput = {
    ...scope,
    ...(filters.drawId ? { drawId: filters.drawId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(selectedStatus ? { status: selectedStatus } : {}),
    ...(validFrom || validTo ? { createdAt: { ...(validFrom ? { gte: validFrom } : {}), ...(validTo ? { lte: validTo } : {}) } } : {}),
  };
  /**
   * บิลที่นำมาคิดยอดเงิน: ถ้าไม่ได้เลือกสถานะ นับเฉพาะบิลที่มีผลผูกพัน
   * เดิมนับบิลร่างและบิลยกเลิกรวมเข้าไปในยอดขายด้วย ซึ่งไม่ตรงกับหน้ารายงาน
   */
  const moneyWhere: Prisma.BillWhereInput = selectedStatus ? listWhere : { ...listWhere, status: { in: COUNTED_STATUSES } };

  const [selectedDraw, drawOptions, totals, itemCount, perAgent, recentBills, winnerTitles, awaitingClose, pendingCancellations, anomalyCount, activeAgents, settlementByDraw, settlementByAgent] = await Promise.all([
    filters.drawId ? prisma.draw.findFirst({ where: { ...scope, id: filters.drawId }, select: drawSelect }) : Promise.resolve(null),
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, opensAt: true, cutoffAt: true } }),
    prisma.bill.aggregate({ where: moneyWhere, _count: { _all: true }, _sum: { totalStake: true, totalPayout: true } }),
    prisma.billItem.count({ where: { bill: moneyWhere } }),
    prisma.bill.groupBy({ by: ["agentId"], where: moneyWhere, _count: { _all: true }, _sum: { totalStake: true } }),
    prisma.bill.findMany({
      where: listWhere,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      select: { id: true, billNumber: true, title: true, status: true, totalStake: true, createdAt: true, agent: { select: { code: true, name: true } } },
    }),
    prisma.bill.groupBy({ by: ["title"], where: { ...moneyWhere, totalPayout: { gt: 0 } }, _count: { _all: true } }),
    prisma.draw.count({ where: { ...scope, status: "SETTLED" } }),
    prisma.bill.count({ where: { ...scope, cancelRequestedAt: { not: null }, cancelledAt: null } }),
    prisma.settlement.count({ where: { ...scope, net: { lt: 0 } } }),
    prisma.agent.count({ where: { ...scope, status: "ACTIVE" } }),
    prisma.settlement.groupBy({
      by: ["drawId"],
      where: { ...scope, ...(filters.drawId ? { drawId: filters.drawId } : {}), ...(filters.agentId ? { agentId: filters.agentId } : {}) },
      _sum: { gross: true, payout: true, commission: true, net: true },
    }),
    prisma.settlement.groupBy({
      by: ["agentId"],
      where: { ...scope, ...(filters.drawId ? { drawId: filters.drawId } : {}), ...(filters.agentId ? { agentId: filters.agentId } : {}) },
      _sum: { gross: true, payout: true, commission: true, net: true },
    }),
  ]);

  // งวดปัจจุบัน: งวดที่เลือก หรืองวดล่าสุดที่ยังไม่ปิด หรืองวดล่าสุด — ใช้รายการงวดที่ดึงมาแล้ว ไม่ query ซ้ำ
  const currentDraw = selectedDraw
    ?? drawOptions.find((draw) => ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED"].includes(draw.status))
    ?? drawOptions[0]
    ?? null;

  const agentIds = [...new Set([...perAgent.map((row) => row.agentId), ...settlementByAgent.map((row) => row.agentId)])];
  const agents = agentIds.length === 0 ? [] : await prisma.agent.findMany({
    where: { ...scope, id: { in: agentIds } },
    select: { id: true, code: true, name: true, commissionRate: true },
  });
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));

  const gross = num(totals._sum.totalStake);
  const payout = num(totals._sum.totalPayout);
  // คอมมิชชันคิดจากอัตราของ Agent แต่ละราย เหมือนเดิม แต่รวมยอดต่อ Agent ในฐานข้อมูลก่อน
  const commission = perAgent.reduce((sum, row) => sum + num(row._sum.totalStake) * num(agentById.get(row.agentId)?.commissionRate) / 100, 0);
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

  const rankedAgents = perAgent
    .map((row) => ({
      agentCode: agentById.get(row.agentId)?.code ?? "-",
      agentName: agentById.get(row.agentId)?.name ?? "-",
      gross: num(row._sum.totalStake),
      billCount: row._count._all,
    }))
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 5);

  const drawById = new Map(drawOptions.map((draw) => [draw.id, draw]));
  const drawFinance = settlementByDraw
    .map((row) => ({ draw: drawById.get(row.drawId), sum: row._sum }))
    .filter((row) => row.draw !== undefined)
    .sort((a, b) => (b.draw?.cutoffAt.getTime() ?? 0) - (a.draw?.cutoffAt.getTime() ?? 0))
    .slice(0, 4)
    .map(({ draw, sum }) => ({ label: draw?.name ?? "-", gross: num(sum.gross), payout: num(sum.payout), commission: num(sum.commission), net: num(sum.net) }));
  const agentFinance = settlementByAgent
    .map((row) => {
      const agent = agentById.get(row.agentId);
      return { label: agent ? `${agent.code} ${agent.name}` : "-", gross: num(row._sum.gross), payout: num(row._sum.payout), commission: num(row._sum.commission), net: num(row._sum.net) };
    })
    .sort((a, b) => b.gross - a.gross)
    .slice(0, 5);

  return {
    selectedStatus,
    currentDraw,
    drawOptions: drawOptions.map(({ id, name, status }) => ({ id, name, status })),
    summary,
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

import { Prisma } from "@prisma/client";
import type { BillStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { billScope, orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/errors";
import { sumMoney, ZERO } from "@/lib/money";

/**
 * รายงานและ Dashboard (P4)
 *
 * ตัวเลขทุกตัวอ่านจากแหล่งเดียวกับที่ Settlement ใช้คำนวณ คือ bills
 * และ bill_items ที่ผ่านการ settle แล้ว จึงตรงกันโดยโครงสร้าง
 * ไม่ใช่เพราะบังเอิญคำนวณเหมือนกัน
 *
 * สถานะบิลที่นับ: CONFIRMED, LOCKED, SETTLED
 * ไม่นับบิลร่างและบิลที่ยกเลิก เพราะไม่มีผลผูกพันทางการเงิน
 */

const COUNTED_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];

/** Agent เห็นเฉพาะข้อมูลของตนเอง บทบาทอื่นต้องมีสิทธิ์ดูยอดรวมทุก Agent */
function reportScope(actor: Actor) {
  return billScope(actor);
}

export type DrawSummary = {
  drawId: string;
  drawName: string;
  drawStatus: string;
  billCount: number;
  itemCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
  /** true เมื่อรอบยังไม่ถูกคำนวณ ตัวเลขจ่ายและสุทธิจึงยังไม่สมบูรณ์ */
  pendingSettlement: boolean;
};

export async function drawSummary(actor: Actor, drawId: string): Promise<DrawSummary> {
  requirePermission(actor, "bill.viewOwn");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, name: true, status: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบรอบ");

  const where = { ...reportScope(actor), drawId: draw.id, status: { in: COUNTED_STATUSES } };

  const [billAgg, itemAgg, settlements] = await Promise.all([
    prisma.bill.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalStake: true, totalPayout: true },
    }),
    prisma.billItem.aggregate({ where: { bill: where }, _count: { _all: true } }),
    prisma.settlement.findMany({
      where: {
        drawId: draw.id,
        ...orgScope(actor),
        ...(actor.role === "AGENT" && { agentId: actor.agentId ?? "__no_agent__" }),
      },
      select: { commission: true, net: true },
    }),
  ]);

  const gross = billAgg._sum.totalStake ?? ZERO;
  const payout = billAgg._sum.totalPayout ?? ZERO;
  const commission = sumMoney(settlements.map((s) => s.commission));
  const net = sumMoney(settlements.map((s) => s.net));

  return {
    drawId: draw.id,
    drawName: draw.name,
    drawStatus: draw.status,
    billCount: billAgg._count._all,
    itemCount: itemAgg._count._all,
    gross,
    payout,
    commission,
    net,
    pendingSettlement: settlements.length === 0,
  };
}

export type AgentRow = {
  agentCode: string;
  agentName: string;
  billCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
};

/** รายงานแยกตาม Agent (LOT-27) */
export async function byAgent(actor: Actor, drawId: string): Promise<AgentRow[]> {
  requirePermission(actor, "bill.viewOwn");

  const bills = await prisma.bill.findMany({
    where: { ...reportScope(actor), drawId, status: { in: COUNTED_STATUSES } },
    select: {
      agentId: true,
      totalStake: true,
      totalPayout: true,
      agent: { select: { code: true, name: true } },
    },
  });

  const settlements = await prisma.settlement.findMany({
    where: {
      drawId,
      ...orgScope(actor),
      ...(actor.role === "AGENT" && { agentId: actor.agentId ?? "__no_agent__" }),
    },
    select: { agentId: true, commission: true, net: true },
  });
  const settlementByAgent = new Map(settlements.map((s) => [s.agentId, s]));

  const buckets = new Map<
    string,
    { code: string; name: string; bills: number; stakes: Prisma.Decimal[]; payouts: Prisma.Decimal[] }
  >();

  for (const bill of bills) {
    let bucket = buckets.get(bill.agentId);
    if (!bucket) {
      bucket = { code: bill.agent.code, name: bill.agent.name, bills: 0, stakes: [], payouts: [] };
      buckets.set(bill.agentId, bucket);
    }
    bucket.bills += 1;
    bucket.stakes.push(bill.totalStake);
    bucket.payouts.push(bill.totalPayout);
  }

  return [...buckets.entries()]
    .map(([agentId, b]) => {
      const settlement = settlementByAgent.get(agentId);
      return {
        agentCode: b.code,
        agentName: b.name,
        billCount: b.bills,
        gross: sumMoney(b.stakes),
        payout: sumMoney(b.payouts),
        commission: settlement?.commission ?? ZERO,
        net: settlement?.net ?? ZERO,
      };
    })
    .sort((a, b) => a.agentCode.localeCompare(b.agentCode));
}

export type PrizeTypeRow = {
  code: number;
  name: string;
  itemCount: number;
  winnerCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
};

/** รายงานแยกตามประเภทรางวัล 1 ถึง 16 (LOT-30) */
export async function byPrizeType(actor: Actor, drawId: string): Promise<PrizeTypeRow[]> {
  requirePermission(actor, "bill.viewOwn");

  const items = await prisma.billItem.findMany({
    where: {
      bill: { ...reportScope(actor), drawId, status: { in: COUNTED_STATUSES } },
    },
    select: {
      stake: true,
      payout: true,
      isWinner: true,
      prizeType: { select: { code: true, name: true } },
    },
  });

  const buckets = new Map<
    number,
    { name: string; items: number; winners: number; stakes: Prisma.Decimal[]; payouts: Prisma.Decimal[] }
  >();

  for (const item of items) {
    const code = item.prizeType.code;
    let bucket = buckets.get(code);
    if (!bucket) {
      bucket = { name: item.prizeType.name, items: 0, winners: 0, stakes: [], payouts: [] };
      buckets.set(code, bucket);
    }
    bucket.items += 1;
    bucket.stakes.push(item.stake);
    if (item.isWinner) {
      bucket.winners += 1;
      bucket.payouts.push(item.payout);
    }
  }

  return [...buckets.entries()]
    .map(([code, b]) => ({
      code,
      name: b.name,
      itemCount: b.items,
      winnerCount: b.winners,
      gross: sumMoney(b.stakes),
      payout: sumMoney(b.payouts),
    }))
    .sort((a, b) => a.code - b.code);
}

export type BillSearchFilter = {
  query?: string | undefined;
  drawId?: string | undefined;
  agentId?: string | undefined;
  status?: BillStatus | undefined;
};

/**
 * ค้นหาบิล (LOT-37)
 *
 * ค้นได้ตามเลขบิลและชื่อบิล กรองตามรอบ Agent และสถานะ
 * ผลลัพธ์ถูกจำกัดด้วย billScope เสมอ Agent จึงค้นเจอเฉพาะบิลของตนเอง
 */
export async function searchBills(actor: Actor, filter: BillSearchFilter) {
  requirePermission(actor, "bill.viewOwn");

  const query = filter.query?.trim();

  // Agent ระบุ agentId ของคนอื่นไม่ได้ billScope ทับค่านี้อยู่แล้ว
  const agentFilter =
    filter.agentId !== undefined && can(actor.role, "report.viewAllAgents")
      ? { agentId: filter.agentId }
      : {};

  return prisma.bill.findMany({
    where: {
      ...reportScope(actor),
      ...agentFilter,
      ...(filter.drawId !== undefined && { drawId: filter.drawId }),
      ...(filter.status !== undefined && { status: filter.status }),
      ...(query !== undefined &&
        query !== "" && {
          OR: [
            { billNumber: { contains: query, mode: "insensitive" as const } },
            { title: { contains: query, mode: "insensitive" as const } },
          ],
        }),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      billNumber: true,
      title: true,
      status: true,
      totalStake: true,
      totalPayout: true,
      createdAt: true,
      agent: { select: { code: true, name: true } },
      draw: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });
}

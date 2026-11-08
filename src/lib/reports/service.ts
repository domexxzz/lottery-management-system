import { Prisma } from "@prisma/client";
import type { BillStatus } from "@prisma/client";
import { databaseSchema, prisma } from "@/lib/db";
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

type ReportTable = "agents" | "bills" | "bill_items" | "prize_types" | "settlements";

function reportTable(name: ReportTable) {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

/** เงื่อนไขส่วนกลางของ SQL รายงาน ต้องคงขอบเขตองค์กรและ Agent เหมือน billScope เสมอ */
function reportBillSql(actor: Actor, drawId?: string) {
  return Prisma.sql`
    b."organizationId" = ${actor.organizationId}
    AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
    ${drawId ? Prisma.sql`AND b."drawId" = ${drawId}` : Prisma.empty}
    ${actor.role === "AGENT" ? Prisma.sql`AND b."agentId" = ${actor.agentId ?? "__no_agent__"}` : Prisma.empty}
  `;
}

function reportSettlementSql(actor: Actor, drawId?: string) {
  return Prisma.sql`
    s."organizationId" = ${actor.organizationId}
    ${drawId ? Prisma.sql`AND s."drawId" = ${drawId}` : Prisma.empty}
    ${actor.role === "AGENT" ? Prisma.sql`AND s."agentId" = ${actor.agentId ?? "__no_agent__"}` : Prisma.empty}
  `;
}

function decimal(value: Prisma.Decimal | string | number | null): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value ?? 0);
}

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

export async function drawSummary(actor: Actor, drawId?: string): Promise<DrawSummary> {
  requirePermission(actor, "bill.viewOwn");

  const draw = drawId ? await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, name: true, status: true },
  }) : null;
  if (drawId && !draw) throw new NotFoundError("ไม่พบรอบ");

  const where: Prisma.BillWhereInput = {
    ...reportScope(actor),
    ...(draw ? { drawId: draw.id } : {}),
    status: { in: COUNTED_STATUSES },
  };

  const [billAgg, itemAgg, billDraws, settlements] = await Promise.all([
    prisma.bill.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalStake: true, totalPayout: true },
    }),
    prisma.billItem.aggregate({ where: { bill: where }, _count: { _all: true } }),
    prisma.bill.findMany({ where, distinct: ["drawId"], select: { drawId: true } }),
    prisma.settlement.findMany({
      where: {
        ...orgScope(actor),
        ...(draw ? { drawId: draw.id } : {}),
        ...(actor.role === "AGENT" && { agentId: actor.agentId ?? "__no_agent__" }),
      },
      select: { drawId: true, commission: true, net: true },
    }),
  ]);

  const gross = billAgg._sum.totalStake ?? ZERO;
  const payout = billAgg._sum.totalPayout ?? ZERO;
  const commission = sumMoney(settlements.map((s) => s.commission));
  const net = sumMoney(settlements.map((s) => s.net));

  const settledDrawIds = new Set(settlements.map((settlement) => settlement.drawId));
  const pendingSettlement = draw
    ? settlements.length === 0
    : billDraws.some((bill) => !settledDrawIds.has(bill.drawId));

  return {
    drawId: draw?.id ?? "all",
    drawName: draw?.name ?? "ทุกรอบ",
    drawStatus: draw?.status ?? "ALL",
    billCount: billAgg._count._all,
    itemCount: itemAgg._count._all,
    gross,
    payout,
    commission,
    net,
    pendingSettlement,
  };
}

export type AgentRow = {
  agentId: string;
  agentCode: string;
  agentName: string;
  billCount: number;
  itemCount: number;
  winnerCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
};

/** รายงานแยกตาม Agent (LOT-27) */
export async function byAgent(actor: Actor, drawId?: string): Promise<AgentRow[]> {
  requirePermission(actor, "bill.viewOwn");

  type Row = {
    agentId: string;
    agentCode: string;
    agentName: string;
    billCount: number;
    itemCount: number;
    winnerCount: number;
    gross: Prisma.Decimal | string;
    payout: Prisma.Decimal | string;
    commission: Prisma.Decimal | string;
    net: Prisma.Decimal | string;
  };

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH bill_agg AS (
      SELECT b."agentId",
             COUNT(*)::int AS "billCount",
             COALESCE(SUM(b."totalStake"), 0) AS gross,
             COALESCE(SUM(b."totalPayout"), 0) AS payout
      FROM ${reportTable("bills")} b
      WHERE ${reportBillSql(actor, drawId)}
      GROUP BY b."agentId"
    ), item_agg AS (
      SELECT b."agentId",
             COUNT(i.id)::int AS "itemCount",
             COUNT(i.id) FILTER (WHERE i."isWinner")::int AS "winnerCount"
      FROM ${reportTable("bills")} b
      JOIN ${reportTable("bill_items")} i ON i."billId" = b.id
      WHERE ${reportBillSql(actor, drawId)}
      GROUP BY b."agentId"
    ), settlement_agg AS (
      SELECT s."agentId",
             COALESCE(SUM(s.commission), 0) AS commission,
             COALESCE(SUM(s.net), 0) AS net
      FROM ${reportTable("settlements")} s
      WHERE ${reportSettlementSql(actor, drawId)}
      GROUP BY s."agentId"
    )
    SELECT ba."agentId",
           a.code AS "agentCode",
           a.name AS "agentName",
           ba."billCount",
           COALESCE(ia."itemCount", 0)::int AS "itemCount",
           COALESCE(ia."winnerCount", 0)::int AS "winnerCount",
           ba.gross,
           ba.payout,
           COALESCE(sa.commission, 0) AS commission,
           COALESCE(sa.net, 0) AS net
    FROM bill_agg ba
    JOIN ${reportTable("agents")} a ON a.id = ba."agentId"
    LEFT JOIN item_agg ia ON ia."agentId" = ba."agentId"
    LEFT JOIN settlement_agg sa ON sa."agentId" = ba."agentId"
    ORDER BY a.code
  `);

  return rows.map((row) => ({
    ...row,
    gross: decimal(row.gross),
    payout: decimal(row.payout),
    commission: decimal(row.commission),
    net: decimal(row.net),
  }));
}

export type DrawReportRow = {
  drawId: string;
  drawName: string;
  cutoffAt: Date;
  billCount: number;
  itemCount: number;
  winnerCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
};

/** แนวโน้มรายงวดสำหรับกราฟเจาะลึก เรียงเก่าไปใหม่เพื่อแสดงเส้นเวลา */
export async function byDraw(actor: Actor, drawId?: string): Promise<DrawReportRow[]> {
  requirePermission(actor, "bill.viewOwn");
  const draws = await prisma.draw.findMany({
    where: {
      ...orgScope(actor),
      ...(drawId ? { id: drawId } : {}),
      bills: { some: { ...reportScope(actor), status: { in: COUNTED_STATUSES } } },
    },
    orderBy: { cutoffAt: "desc" },
    take: drawId ? 1 : 24,
    select: { id: true, name: true, cutoffAt: true },
  });
  const drawIds = draws.map((draw) => draw.id);
  if (drawIds.length === 0) return [];

  type AggregateRow = {
    drawId: string;
    billCount: number;
    itemCount: number;
    winnerCount: number;
    gross: Prisma.Decimal | string;
    payout: Prisma.Decimal | string;
    commission: Prisma.Decimal | string;
    net: Prisma.Decimal | string;
  };
  const aggregates = await prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    WITH bill_agg AS (
      SELECT b."drawId",
             COUNT(*)::int AS "billCount",
             COALESCE(SUM(b."totalStake"), 0) AS gross,
             COALESCE(SUM(b."totalPayout"), 0) AS payout
      FROM ${reportTable("bills")} b
      WHERE ${reportBillSql(actor)} AND b."drawId" IN (${Prisma.join(drawIds)})
      GROUP BY b."drawId"
    ), item_agg AS (
      SELECT b."drawId",
             COUNT(i.id)::int AS "itemCount",
             COUNT(i.id) FILTER (WHERE i."isWinner")::int AS "winnerCount"
      FROM ${reportTable("bills")} b
      JOIN ${reportTable("bill_items")} i ON i."billId" = b.id
      WHERE ${reportBillSql(actor)} AND b."drawId" IN (${Prisma.join(drawIds)})
      GROUP BY b."drawId"
    ), settlement_agg AS (
      SELECT s."drawId",
             COALESCE(SUM(s.commission), 0) AS commission,
             COALESCE(SUM(s.net), 0) AS net
      FROM ${reportTable("settlements")} s
      WHERE ${reportSettlementSql(actor)} AND s."drawId" IN (${Prisma.join(drawIds)})
      GROUP BY s."drawId"
    )
    SELECT ba."drawId", ba."billCount",
           COALESCE(ia."itemCount", 0)::int AS "itemCount",
           COALESCE(ia."winnerCount", 0)::int AS "winnerCount",
           ba.gross, ba.payout,
           COALESCE(sa.commission, 0) AS commission,
           COALESCE(sa.net, 0) AS net
    FROM bill_agg ba
    LEFT JOIN item_agg ia ON ia."drawId" = ba."drawId"
    LEFT JOIN settlement_agg sa ON sa."drawId" = ba."drawId"
  `);
  const aggregateByDraw = new Map(aggregates.map((row) => [row.drawId, row]));

  return draws.reverse().map((draw) => {
    const aggregate = aggregateByDraw.get(draw.id);
    return {
      drawId: draw.id,
      drawName: draw.name,
      cutoffAt: draw.cutoffAt,
      billCount: aggregate?.billCount ?? 0,
      itemCount: aggregate?.itemCount ?? 0,
      winnerCount: aggregate?.winnerCount ?? 0,
      gross: decimal(aggregate?.gross ?? null),
      payout: decimal(aggregate?.payout ?? null),
      commission: decimal(aggregate?.commission ?? null),
      net: decimal(aggregate?.net ?? null),
    };
  });
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
export async function byPrizeType(actor: Actor, drawId?: string): Promise<PrizeTypeRow[]> {
  requirePermission(actor, "bill.viewOwn");

  type Row = {
    code: number;
    name: string;
    itemCount: number;
    winnerCount: number;
    gross: Prisma.Decimal | string;
    payout: Prisma.Decimal | string;
  };
  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT pt.code,
           pt.name,
           COUNT(i.id)::int AS "itemCount",
           COUNT(i.id) FILTER (WHERE i."isWinner")::int AS "winnerCount",
           COALESCE(SUM(i.stake), 0) AS gross,
           COALESCE(SUM(i.payout), 0) AS payout
    FROM ${reportTable("bill_items")} i
    JOIN ${reportTable("bills")} b ON b.id = i."billId"
    JOIN ${reportTable("prize_types")} pt ON pt.id = i."prizeTypeId"
    WHERE ${reportBillSql(actor, drawId)}
    GROUP BY pt.id, pt.code, pt.name
    ORDER BY pt.code
  `);

  return rows.map((row) => ({
    ...row,
    gross: decimal(row.gross),
    payout: decimal(row.payout),
  }));
}

export type BillSearchFilter = {
  query?: string | undefined;
  drawId?: string | undefined;
  agentId?: string | undefined;
  status?: BillStatus | undefined;
  winnerOnly?: boolean | undefined;
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
      ...(filter.winnerOnly && { totalPayout: { gt: 0 } }),
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

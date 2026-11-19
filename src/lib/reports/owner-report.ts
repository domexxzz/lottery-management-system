import { Prisma, type DrawStatus, type LotteryType } from "@prisma/client";
import { databaseSchema, prisma } from "@/lib/db";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { bangkokToday } from "./accounting-period";

/**
 * รายงานสำหรับ Owner/Admin: ตอบ 2 คำถาม
 * 1) งวดนี้ได้หรือเสีย  2) เงินมาจากไหน ไปไหน
 *
 * ออกแบบให้เร็วแม้ข้อมูลเยอะ:
 * - ดูทีละงวด (ค่าเริ่มต้นคืองวดล่าสุดที่คำนวณแล้ว) ไม่รวมประวัติทั้งหมดทุกครั้งที่เปิดหน้า
 * - ยอดเงินรวมจากตาราง bills (ยอดรวมต่อบิลเก็บไว้แล้ว) และ settlements (แถวเดียวต่อ Agent ต่องวด)
 *   ไม่ต้องไล่รายการแทงทีละรายการ ยกเว้นสรุปประเภทรางวัลซึ่งจำกัดอยู่ในงวดเดียว
 * - แนวโน้มดูแค่ 12 งวดล่าสุด
 *
 * สูตรเดียวกับการคำนวณปิดงวด: กำไร = ยอดขาย − จ่ายรางวัล − ค่าคอม (netOf)
 */

export const TREND_DRAWS = 12;
export const TOP_ROWS = 5;
const PICKER_DRAWS = 24;

const SETTLED: readonly DrawStatus[] = ["SETTLED", "CLOSED"];

type Table = "bills" | "bill_items" | "prize_types" | "settlements" | "agents" | "draws";
function table(name: Table) {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

/** เงื่อนไขกรองบิลตามขอบเขต (อ้าง alias b ของตาราง bills) */
function billScopeSql(actor: Actor, scope: ReportScope) {
  if (scope.kind === "draw") return Prisma.sql`b."drawId" = ${scope.drawId}`;
  if (isAllLotteries(scope.lotteries)) return Prisma.sql`TRUE`;
  return Prisma.sql`b."drawId" IN (
    SELECT d.id FROM ${table("draws")} d
    WHERE d."organizationId" = ${actor.organizationId} AND d."lotteryType"::text IN (${Prisma.join(scope.lotteries)})
  )`;
}

/** งวดที่คำนวณแล้วในขอบเขต "ทุกงวด" ใช้รวมค่าคอมและกำไรของ Agent */
function settledDrawsSql(actor: Actor, lotteries: ReportLottery) {
  return Prisma.sql`SELECT d.id FROM ${table("draws")} d
    WHERE d."organizationId" = ${actor.organizationId}
      AND d.status::text IN ('SETTLED', 'CLOSED')
      ${isAllLotteries(lotteries) ? Prisma.empty : Prisma.sql`AND d."lotteryType"::text IN (${Prisma.join(lotteries)})`}`;
}

const dec = (value: Prisma.Decimal | string | number | null | undefined) =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value ?? 0);

export type ReportDraw = {
  id: string;
  name: string;
  drawDate: Date | null;
  cutoffAt: Date;
  status: DrawStatus;
  lotteryType: LotteryType;
};

export type DrawMoney = {
  draw: ReportDraw;
  /** คำนวณผลแล้ว ตัวเลขจ่ายรางวัล ค่าคอม และกำไรเชื่อถือได้ */
  settled: boolean;
  billCount: number;
  agentCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
};

export type AgentMoney = {
  agentId: string;
  code: string;
  name: string;
  billCount: number;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
};

export type PrizeMoney = {
  code: number;
  name: string;
  itemCount: number;
  winnerCount: number;
  gross: Prisma.Decimal;
  /** ยอดขายของงวดที่คำนวณแล้ว ใช้หาส่วนที่เหลือหลังจ่ายรางวัลโดยไม่ปนยอดงวดที่ยังไม่ออกผล */
  settledGross: Prisma.Decimal;
  payout: Prisma.Decimal;
};

/** ผลรวมเมื่อเลือก "ทุกงวด" กำไร จ่ายรางวัล และค่าคอม นับเฉพาะงวดที่คำนวณแล้ว */
export type AllDrawsMoney = {
  drawCount: number;
  settledCount: number;
  billCount: number;
  agentCount: number;
  /** ยอดขายทุกงวด รวมงวดที่ยังไม่คำนวณ */
  gross: Prisma.Decimal;
  /** ยอดขายเฉพาะงวดที่คำนวณแล้ว ใช้ในสมการ ยอดขาย − จ่าย − คอม = กำไร ให้ลงตัว */
  settledGross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
  firstDraw: ReportDraw | null;
  lastDraw: ReportDraw | null;
};

export type OwnerReport = {
  draws: ReportDraw[];
  /** งวดที่เลือก null เมื่อดูทุกงวด */
  selected: DrawMoney | null;
  /** ผลรวมทุกงวด มีค่าเมื่อเลือก "ทุกงวด" */
  all: AllDrawsMoney | null;
  previous: DrawMoney | null;
  /** เก่า → ใหม่ จบที่งวดที่เลือก */
  trend: DrawMoney[];
  agents: AgentMoney[];
  agentTotal: number;
  prizes: PrizeMoney[];
  /** ประเภทหวยที่กรองอยู่ เลือกได้หลายประเภท (ครบทุกประเภท = ทุกประเภท) */
  lotteries: ReportLottery;
  /** ยอด 30 วันล่าสุดแยกตามประเภทหวย (แสดงเมื่อดูทุกประเภท) */
  breakdown: LotteryBreakdown[];
  /** ช่วงวันที่ (เวลาไทย) ของ breakdown ใช้ลิงก์ไปสรุปบัญชีช่วงเดียวกัน */
  breakdownRange: { from: string; to: string };
  winners: WinnerSummary;
};

/** ผู้ถูกรางวัลในขอบเขตที่ดู */
export type WinnerSummary = {
  billCount: number;
  itemCount: number;
  customerCount: number;
  payout: Prisma.Decimal;
  /** บิลที่ได้รางวัลมากสุด */
  top: {
    billId: string;
    sequence: number | null;
    customer: string;
    agentCode: string;
    agentName: string;
    drawLabel: string;
    winningItems: number;
    payout: Prisma.Decimal;
  }[];
};

/** ขอบเขตของรายงาน: งวดเดียว หรือทุกงวดของประเภทหวยที่เลือก */
type ReportScope = { kind: "draw"; drawId: string } | { kind: "all"; lotteries: ReportLottery };

/** ค่า draw ใน URL ของ "ทุกงวด" */
export const ALL_DRAWS = "all";

export const REPORT_LOTTERIES = ["THAI_GOVERNMENT", "LAO", "LAO_SET"] as const;
export type ReportLotteryType = (typeof REPORT_LOTTERIES)[number];
/** ประเภทหวยที่เลือก เรียงตามลำดับมาตรฐานเสมอ ไม่ว่าง (ครบสามประเภท = ทุกประเภท) */
export type ReportLottery = readonly ReportLotteryType[];
export const isAllLotteries = (lotteries: ReportLottery) => lotteries.length === REPORT_LOTTERIES.length;
export const BREAKDOWN_DAYS = 30;

/**
 * ช่วงของ breakdown: 30 วันล่าสุดรวมวันนี้ (เวลาไทย)
 * นับงวดจากวันออกผลแบบเดียวกับสรุปบัญชี ลิงก์ไปสรุปบัญชีจึงได้ตัวเลขชุดเดียวกัน
 */
export function breakdownRange(now = new Date()): { from: string; to: string } {
  return { from: bangkokToday(new Date(now.getTime() - (BREAKDOWN_DAYS - 1) * 86_400_000)), to: bangkokToday(now) };
}

export type LotteryBreakdown = {
  lotteryType: LotteryType;
  drawCount: number;
  settledCount: number;
  /** ยอดขายทุกงวดในช่วง */
  gross: Prisma.Decimal;
  /** ยอดขายของงวดที่คำนวณแล้ว ฐานเดียวกับจ่ายรางวัล ค่าคอม และกำไร */
  settledGross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
};

/** ?lottery=LAO หรือ ?lottery=THAI_GOVERNMENT,LAO ค่าว่าง/ผิด = ทุกประเภท */
export function parseReportLottery(raw: string | undefined): ReportLottery {
  const requested = (raw ?? "").split(",");
  const lotteries = REPORT_LOTTERIES.filter((lottery) => requested.includes(lottery));
  return lotteries.length === 0 ? [...REPORT_LOTTERIES] : lotteries;
}

/** ค่า lottery ใน URL ("" = ทุกประเภท) */
export function reportLotteryParam(lotteries: ReportLottery): string {
  return isAllLotteries(lotteries) ? "" : lotteries.join(",");
}

/** งวดเริ่มต้น: งวดล่าสุดที่คำนวณแล้ว ถ้ายังไม่มีเลยใช้งวดล่าสุด */
export function defaultReportDraw<T extends { status: DrawStatus }>(draws: readonly T[]): T | null {
  return draws.find((draw) => SETTLED.includes(draw.status)) ?? draws[0] ?? null;
}

async function moneyByDraw(actor: Actor, draws: readonly ReportDraw[]): Promise<Map<string, DrawMoney>> {
  if (draws.length === 0) return new Map();
  const ids = draws.map((draw) => draw.id);
  const rows = await prisma.$queryRaw<{
    drawId: string; billCount: number; agentCount: number;
    gross: Prisma.Decimal; payout: Prisma.Decimal;
    settlementCount: number; commission: Prisma.Decimal; net: Prisma.Decimal;
  }[]>(Prisma.sql`
    WITH bill_agg AS (
      SELECT b."drawId",
             COUNT(*)::int AS "billCount",
             COUNT(DISTINCT b."agentId")::int AS "agentCount",
             COALESCE(SUM(b."totalStake"), 0) AS gross,
             COALESCE(SUM(b."totalPayout"), 0) AS payout
      FROM ${table("bills")} b
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
        AND b."drawId" IN (${Prisma.join(ids)})
      GROUP BY b."drawId"
    ), settlement_agg AS (
      SELECT s."drawId", COUNT(*)::int AS "settlementCount",
             COALESCE(SUM(s.commission), 0) AS commission,
             COALESCE(SUM(s.net), 0) AS net
      FROM ${table("settlements")} s
      WHERE s."organizationId" = ${actor.organizationId}
        AND s."drawId" IN (${Prisma.join(ids)})
      GROUP BY s."drawId"
    )
    SELECT ba."drawId", ba."billCount", ba."agentCount", ba.gross, ba.payout,
           COALESCE(sa."settlementCount", 0)::int AS "settlementCount",
           COALESCE(sa.commission, 0) AS commission,
           COALESCE(sa.net, 0) AS net
    FROM bill_agg ba
    LEFT JOIN settlement_agg sa ON sa."drawId" = ba."drawId"
  `);
  const byId = new Map(rows.map((row) => [row.drawId, row]));
  return new Map(draws.map((draw) => {
    const row = byId.get(draw.id);
    const settled = SETTLED.includes(draw.status) && (row?.settlementCount ?? 0) > 0;
    const gross = dec(row?.gross);
    const payout = dec(row?.payout);
    const commission = settled ? dec(row?.commission) : new Prisma.Decimal(0);
    return [draw.id, {
      draw,
      settled,
      billCount: row?.billCount ?? 0,
      agentCount: row?.agentCount ?? 0,
      gross,
      payout,
      commission,
      net: settled ? dec(row?.net) : new Prisma.Decimal(0),
    }];
  }));
}

async function agentsOf(actor: Actor, scope: ReportScope): Promise<{ rows: AgentMoney[]; total: number }> {
  // งวดเดียวใช้ Settlement ของงวดนั้นตามเดิม ทุกงวดรวมเฉพาะ Settlement ของงวดที่คำนวณแล้ว
  const settlementFilter = scope.kind === "draw"
    ? Prisma.sql`s."drawId" = ${scope.drawId}`
    : Prisma.sql`s."drawId" IN (${settledDrawsSql(actor, scope.lotteries)})`;
  const rows = await prisma.$queryRaw<{
    agentId: string; code: string; name: string; billCount: number;
    gross: Prisma.Decimal; payout: Prisma.Decimal; commission: Prisma.Decimal; net: Prisma.Decimal; total: number;
  }[]>(Prisma.sql`
    WITH bill_agg AS (
      SELECT b."agentId", COUNT(*)::int AS "billCount",
             COALESCE(SUM(b."totalStake"), 0) AS gross,
             COALESCE(SUM(b."totalPayout"), 0) AS payout
      FROM ${table("bills")} b
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
        AND ${billScopeSql(actor, scope)}
      GROUP BY b."agentId"
    ), settlement_agg AS (
      SELECT s."agentId", COALESCE(SUM(s.commission), 0) AS commission, COALESCE(SUM(s.net), 0) AS net
      FROM ${table("settlements")} s
      WHERE s."organizationId" = ${actor.organizationId} AND ${settlementFilter}
      GROUP BY s."agentId"
    )
    SELECT ba."agentId", a.code, a.name, ba."billCount", ba.gross, ba.payout,
           COALESCE(sa.commission, 0) AS commission, COALESCE(sa.net, 0) AS net,
           (COUNT(*) OVER ())::int AS total
    FROM bill_agg ba
    JOIN ${table("agents")} a ON a.id = ba."agentId"
    LEFT JOIN settlement_agg sa ON sa."agentId" = ba."agentId"
    ORDER BY ba.gross DESC, a.code ASC
    LIMIT ${TOP_ROWS}
  `);
  return {
    total: rows[0]?.total ?? 0,
    rows: rows.map((row) => ({
      agentId: row.agentId,
      code: row.code,
      name: row.name,
      billCount: row.billCount,
      gross: dec(row.gross),
      payout: dec(row.payout),
      commission: dec(row.commission),
      net: dec(row.net),
    })),
  };
}

async function prizesOf(actor: Actor, scope: ReportScope): Promise<PrizeMoney[]> {
  const rows = await prisma.$queryRaw<{
    code: number; name: string; itemCount: number; winnerCount: number;
    gross: Prisma.Decimal; settledGross: Prisma.Decimal; payout: Prisma.Decimal;
  }[]>(Prisma.sql`
    SELECT pt.code, pt.name,
           COUNT(i.id)::int AS "itemCount",
           COUNT(i.id) FILTER (WHERE i."isWinner")::int AS "winnerCount",
           COALESCE(SUM(i.stake), 0) AS gross,
           COALESCE(SUM(i.stake) FILTER (WHERE d.status::text IN ('SETTLED', 'CLOSED')), 0) AS "settledGross",
           COALESCE(SUM(i.payout), 0) AS payout
    FROM ${table("bills")} b
    JOIN ${table("draws")} d ON d.id = b."drawId"
    JOIN ${table("bill_items")} i ON i."billId" = b.id
    JOIN ${table("prize_types")} pt ON pt.id = i."prizeTypeId"
    WHERE b."organizationId" = ${actor.organizationId}
      AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
      AND ${billScopeSql(actor, scope)}
    GROUP BY pt.id, pt.code, pt.name
    ORDER BY payout DESC, gross DESC, pt.code ASC
  `);
  return rows.map((row) => ({ ...row, gross: dec(row.gross), settledGross: dec(row.settledGross), payout: dec(row.payout) }));
}

async function winnersOf(actor: Actor, scope: ReportScope): Promise<WinnerSummary> {
  const [totals, top] = await Promise.all([
    prisma.$queryRaw<{ billCount: number; itemCount: number; customerCount: number; payout: Prisma.Decimal }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT b.id) FILTER (WHERE b."totalPayout" > 0)::int AS "billCount",
             COUNT(i.id) FILTER (WHERE i."isWinner")::int AS "itemCount",
             COUNT(DISTINCT (b."agentId", LOWER(BTRIM(b.title)))) FILTER (WHERE b."totalPayout" > 0)::int AS "customerCount",
             COALESCE(SUM(i.payout) FILTER (WHERE i."isWinner"), 0) AS payout
      FROM ${table("bills")} b
      JOIN ${table("bill_items")} i ON i."billId" = b.id
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
        AND ${billScopeSql(actor, scope)}
    `),
    prisma.$queryRaw<{
      billId: string; sequence: number | null; customer: string; agentCode: string; agentName: string;
      drawName: string; drawDate: Date | null; lotteryType: LotteryType; winningItems: number; payout: Prisma.Decimal;
    }[]>(Prisma.sql`
      SELECT b.id AS "billId", b."drawSequence" AS sequence, b.title AS customer,
             a.code AS "agentCode", a.name AS "agentName",
             d.name AS "drawName", d."drawDate", d."lotteryType",
             (SELECT COUNT(*)::int FROM ${table("bill_items")} wi WHERE wi."billId" = b.id AND wi."isWinner") AS "winningItems",
             b."totalPayout" AS payout
      FROM ${table("bills")} b
      JOIN ${table("agents")} a ON a.id = b."agentId"
      JOIN ${table("draws")} d ON d.id = b."drawId"
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
        AND b."totalPayout" > 0
        AND ${billScopeSql(actor, scope)}
      ORDER BY b."totalPayout" DESC, b."createdAt" ASC
      LIMIT ${TOP_ROWS}
    `),
  ]);
  const row = totals[0];
  return {
    billCount: row?.billCount ?? 0,
    itemCount: row?.itemCount ?? 0,
    customerCount: row?.customerCount ?? 0,
    payout: dec(row?.payout),
    top: top.map((item) => ({
      billId: item.billId,
      sequence: item.sequence,
      customer: item.customer,
      agentCode: item.agentCode,
      agentName: item.agentName,
      drawLabel: drawShortLabel({ drawDate: item.drawDate, name: item.drawName }),
      winningItems: item.winningItems,
      payout: dec(item.payout),
    })),
  };
}

const DAY = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });
export function drawShortLabel(draw: Pick<ReportDraw, "drawDate" | "name">): string {
  return draw.drawDate ? DAY.format(draw.drawDate) : draw.name.replace(/^งวด\s*/, "");
}

/** ยอดของงวดในช่วงที่กำหนดแยกตามประเภทหวย กำไรนับเฉพาะงวดที่คำนวณแล้ว */
async function lotteryBreakdown(actor: Actor, range: { from: string; to: string }, lotteries: ReportLottery): Promise<LotteryBreakdown[]> {
  // นับตามวันออกผล = COALESCE(drawDate, วันที่ไทยของ cutoffAt) เหมือนสรุปบัญชี (งวดที่ยังเปิดรับวันนี้ก็นับ)
  const draws = await prisma.draw.findMany({
    where: {
      ...orgScope(actor),
      lotteryType: { in: [...lotteries] },
      OR: [
        { drawDate: { gte: new Date(`${range.from}T00:00:00Z`), lte: new Date(`${range.to}T00:00:00Z`) } },
        { drawDate: null, cutoffAt: { gte: new Date(`${range.from}T00:00:00+07:00`), lt: new Date(new Date(`${range.to}T00:00:00+07:00`).getTime() + 86_400_000) } },
      ],
    },
    select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true },
  });
  const money = await moneyByDraw(actor, draws);
  const zero = () => new Prisma.Decimal(0);
  return lotteries.map((lotteryType) => {
    const rows = draws.filter((draw) => draw.lotteryType === lotteryType).map((draw) => money.get(draw.id)!);
    return rows.reduce<LotteryBreakdown>((sum, row) => ({
      ...sum,
      drawCount: sum.drawCount + 1,
      settledCount: sum.settledCount + (row.settled ? 1 : 0),
      gross: sum.gross.plus(row.gross),
      settledGross: row.settled ? sum.settledGross.plus(row.gross) : sum.settledGross,
      payout: sum.payout.plus(row.settled ? row.payout : 0),
      commission: sum.commission.plus(row.commission),
      net: sum.net.plus(row.net),
    }), { lotteryType, drawCount: 0, settledCount: 0, gross: zero(), settledGross: zero(), payout: zero(), commission: zero(), net: zero() });
  });
}

export async function loadOwnerReport(actor: Actor, drawParam?: string, lotteryParam?: string): Promise<OwnerReport | null> {
  requirePermission(actor, "report.viewAllAgents");
  const lotteries = parseReportLottery(lotteryParam);
  const draws = await prisma.draw.findMany({
    where: { ...orgScope(actor), ...(isAllLotteries(lotteries) ? {} : { lotteryType: { in: [...lotteries] } }) },
    orderBy: { cutoffAt: "desc" },
    take: PICKER_DRAWS,
    select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true },
  });
  if (drawParam === ALL_DRAWS) return loadAllDrawsReport(actor, lotteries, draws);

  const chosen = draws.find((draw) => draw.id === drawParam)
    ?? (drawParam ? await prisma.draw.findFirst({
      where: { ...orgScope(actor), id: drawParam },
      select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true },
    }) : null)
    ?? defaultReportDraw(draws);
  if (!chosen) return null;

  // 12 งวดย้อนหลังนับจากงวดที่เลือก (รวมงวดที่เลือก) เรียงเก่า → ใหม่
  // ใช้ประเภทหวยเดียวกับงวดที่เลือก เทียบ "งวดก่อน" ได้ตรงประเภท
  const trendDraws = (await prisma.draw.findMany({
    where: { ...orgScope(actor), lotteryType: chosen.lotteryType, cutoffAt: { lte: chosen.cutoffAt } },
    orderBy: { cutoffAt: "desc" },
    take: TREND_DRAWS,
    select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true },
  })).reverse();

  const range = breakdownRange();
  const scope: ReportScope = { kind: "draw", drawId: chosen.id };
  const [money, agents, prizes, breakdown, winners] = await Promise.all([
    moneyByDraw(actor, trendDraws),
    agentsOf(actor, scope),
    prizesOf(actor, scope),
    lotteries.length > 1 ? lotteryBreakdown(actor, range, lotteries) : Promise.resolve([]),
    winnersOf(actor, scope),
  ]);
  const trend = trendDraws.map((draw) => money.get(draw.id)!);
  const selected = money.get(chosen.id)!;
  const previous = trend.length > 1 ? trend[trend.length - 2]! : null;
  const pickerDraws = draws.some((draw) => draw.id === chosen.id) ? draws : [chosen, ...draws];

  return {
    draws: pickerDraws,
    selected,
    all: null,
    previous,
    trend,
    agents: agents.rows,
    agentTotal: agents.total,
    prizes,
    lotteries,
    breakdown,
    breakdownRange: range,
    winners,
  };
}

/**
 * "ทุกงวด" ของประเภทหวยที่เลือก (หรือทุกประเภท)
 * ยอดขายรวมทุกงวด ส่วนจ่ายรางวัล ค่าคอม และกำไร รวมเฉพาะงวดที่คำนวณแล้ว
 * ตัวเลขกำไรจึงเท่ากับผลรวมของรายงานรายงวด ไม่เดาจากงวดที่ยังไม่ออกผล
 */
async function loadAllDrawsReport(actor: Actor, lotteries: ReportLottery, pickerDraws: ReportDraw[]): Promise<OwnerReport | null> {
  const allDraws = await prisma.draw.findMany({
    where: { ...orgScope(actor), ...(isAllLotteries(lotteries) ? {} : { lotteryType: { in: [...lotteries] } }) },
    orderBy: { cutoffAt: "asc" },
    select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true },
  });
  if (allDraws.length === 0) return null;

  const range = breakdownRange();
  const scope: ReportScope = { kind: "all", lotteries };
  const [money, agents, prizes, breakdown, winners] = await Promise.all([
    moneyByDraw(actor, allDraws),
    agentsOf(actor, scope),
    prizesOf(actor, scope),
    lotteries.length > 1 ? lotteryBreakdown(actor, range, lotteries) : Promise.resolve([]),
    winnersOf(actor, scope),
  ]);
  const rows = allDraws.map((draw) => money.get(draw.id)!);
  const zero = new Prisma.Decimal(0);
  const all = rows.reduce<AllDrawsMoney>((sum, row) => ({
    ...sum,
    settledCount: sum.settledCount + (row.settled ? 1 : 0),
    billCount: sum.billCount + row.billCount,
    gross: sum.gross.plus(row.gross),
    settledGross: row.settled ? sum.settledGross.plus(row.gross) : sum.settledGross,
    payout: row.settled ? sum.payout.plus(row.payout) : sum.payout,
    commission: sum.commission.plus(row.commission),
    net: sum.net.plus(row.net),
  }), {
    drawCount: allDraws.length,
    settledCount: 0,
    billCount: 0,
    agentCount: agents.total,
    gross: zero,
    settledGross: zero,
    payout: zero,
    commission: zero,
    net: zero,
    firstDraw: allDraws[0] ?? null,
    lastDraw: allDraws.at(-1) ?? null,
  });

  return {
    draws: pickerDraws,
    selected: null,
    all,
    previous: null,
    // กราฟแสดง 12 งวดล่าสุดของขอบเขตนี้
    trend: rows.slice(-TREND_DRAWS),
    agents: agents.rows,
    agentTotal: agents.total,
    prizes,
    lotteries,
    breakdown,
    breakdownRange: range,
    winners,
  };
}

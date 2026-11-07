import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";
import { databaseSchema, prisma } from "@/lib/db";
import { sanitizeLabel } from "./sanitize";

/**
 * การวิเคราะห์ที่ต้องคำนวณจริง — ความเสี่ยง พฤติกรรมลูกค้า และแนวโน้ม
 *
 * หลักการของไฟล์นี้
 *
 * 1. เลขคณิตทุกตัวเกิดในฐานข้อมูล ไม่ใช่ในโมเดลภาษา
 *    SUM, COUNT, AVG และการคูณ stake กับอัตราจ่าย ทำด้วย SQL ทั้งหมด
 *    โมเดลได้รับเฉพาะผลลัพธ์ที่คำนวณเสร็จและจัดอันดับแล้ว หน้าที่ของมันคืออธิบาย
 *
 * 2. ขอบเขตองค์กรผูกเป็นพารามิเตอร์เสมอ
 *    ทุกคิวรีมี "organizationId" = ${actor.organizationId} ผูกด้วย Prisma.sql
 *    ไม่มีการต่อสตริงจากข้อความผู้ใช้เข้าไปใน SQL เลยแม้แต่จุดเดียว
 *
 * 3. แยกข้อเท็จจริงออกจากการคาดการณ์
 *    ตัวเลขในนี้คือสิ่งที่เกิดขึ้นแล้วทั้งหมด ไม่มีการพยากรณ์
 *    ความเสี่ยงคือภาระผูกพันตามบิลที่รับไว้จริง ไม่ใช่โอกาสที่เลขจะออก
 */

/** นับเฉพาะบิลที่มีผลผูกพันทางการเงิน ชุดเดียวกับหน้ารายงาน */
const COUNTED = Prisma.sql`'CONFIRMED', 'LOCKED', 'SETTLED'`;

/**
 * อ้างตารางพร้อม schema เสมอ
 *
 * $queryRaw ไม่ได้ schema จาก Prisma adapter ติดไปด้วย ถ้าปล่อยชื่อตารางเปล่า ๆ
 * Postgres จะหาใน search_path ซึ่งคือ public ทำให้คิวรีไปอ่านฐานผิดตัวโดยไม่มี error
 * ชื่อ schema มาจาก DATABASE_URL ไม่ได้มาจากผู้ใช้ และผ่าน Prisma.raw หลังกรองอักขระแล้ว
 */
function table(name: string): Prisma.Sql {
  const schema = databaseSchema().replace(/[^A-Za-z0-9_]/g, "");
  return Prisma.raw(`"${schema}"."${name}"`);
}

const TOP_LIMIT = 10;
/** ลูกค้าที่ไม่ซื้อติดต่อกันเกินจำนวนรอบนี้ ถือว่าหายไป */
const CHURN_DRAW_WINDOW = 3;

function money(value: unknown): string {
  return Number(value ?? 0).toFixed(2);
}

function count(value: unknown): number {
  return Number(value ?? 0);
}

export type RiskExposure = {
  /** false = ไม่มีภาระผูกพันค้างอยู่เลย ห้ามตอบคำถามความเสี่ยงด้วยตัวเลขจากที่อื่น */
  hasExposure: boolean;
  /** ข้อความสรุปสถานะความเสี่ยงที่ใช้ตอบได้ตรง ๆ */
  summary: string;
  /** รอบที่ยังรับบิลอยู่หรือเพิ่งปิดรับ ซึ่งภาระผูกพันยังไม่ถูกชำระ */
  drawName: string | null;
  drawStatus: string | null;
  totalStake: string;
  /** ยอดจ่ายรวมถ้าทุกเลขที่รับไว้ถูกรางวัลพร้อมกัน — ขอบบนทางทฤษฎี ไม่ใช่สิ่งที่คาดว่าจะเกิด */
  theoreticalMaxPayout: string;
  detailsTruncated: boolean;
  /** เรียงจากภาระผูกพันสูงสุด = ถ้าเลขนี้ออกจะต้องจ่ายมากที่สุด */
  details: {
    rank: number;
    number: string;
    prizeType: string;
    itemCount: number;
    stake: string;
    /** ต้องจ่ายเท่านี้ถ้าเลขนี้ออกในรางวัลประเภทนี้ */
    payoutIfWins: string;
    /** ยอดขายทั้งรอบลบยอดที่ต้องจ่าย ติดลบ = รอบนี้ขาดทุนถ้าเลขนี้ออก */
    netIfWins: string;
  }[];
};

export type CustomerBehavior = {
  totalCustomers: number;
  repeatCustomers: number;
  averageBillsPerCustomer: string;
  averageSpendPerCustomer: string;
  /** ซื้อมาก่อนแต่ไม่ซื้อในรอบล่าสุดที่ผ่านมา */
  churnedCustomers: number;
  churnWindowDraws: number;
  detailsTruncated: boolean;
  /** เรียงจากยอดซื้อรวมมากที่สุด */
  topCustomers: {
    rank: number;
    customerReference: string;
    bills: number;
    drawsPlayed: number;
    totalSpend: string;
    averageBill: string;
    totalWon: string;
    lastSeenDraw: string | null;
  }[];
};

export type SalesTrend = {
  detailsTruncated: boolean;
  /** เรียงจากรอบเก่าไปใหม่ เพื่อให้อ่านทิศทางได้ตรง ๆ */
  details: {
    drawName: string;
    cutoffAt: string;
    bills: number;
    sales: string;
    /** เทียบกับรอบก่อนหน้าเป็นเปอร์เซ็นต์ null = ไม่มีรอบก่อนให้เทียบ */
    changeFromPreviousPercent: string | null;
  }[];
  /** ทิศทางจากรอบแรกถึงรอบล่าสุดในชุดนี้ */
  direction: "increasing" | "decreasing" | "flat" | "insufficient_data";
};

export type OwnerAnalytics = {
  riskExposure: RiskExposure;
  customerBehavior: CustomerBehavior;
  salesTrend: SalesTrend;
};

/**
 * ภาระผูกพันของรอบที่ยังไม่จบ
 *
 * ตอบคำถาม "ถ้าเลขนี้ออก ต้องจ่ายเท่าไร" ด้วยข้อมูลบิลที่รับไว้จริง
 * ใช้ payoutRateSnapshot ซึ่งล็อกไว้ตอนยืนยันบิล ไม่ใช่อัตราปัจจุบัน
 * ตัวเลขจึงตรงกับที่จะต้องจ่ายจริงถ้าเลขนั้นออก
 */
async function buildRiskExposure(actor: Actor): Promise<RiskExposure> {
  /*
   * รอบที่ภาระผูกพันยังค้างอยู่ คือยังไม่ปิดบัญชีและมีบิลที่ยืนยันแล้วจริง
   *
   * ต้องมีเงื่อนไข "มีบิล" ด้วย เพราะรอบที่เพิ่งเปิดยังไม่มีใครซื้อ
   * ถ้าเลือกรอบนั้นมาจะได้ผลว่างทั้งที่รอบก่อนหน้ายังมีภาระค้างอยู่จริง
   */
  const draw = await prisma.draw.findFirst({
    where: {
      organizationId: actor.organizationId,
      status: { notIn: ["CLOSED"] },
      bills: { some: { status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } } },
    },
    orderBy: [{ cutoffAt: "desc" }, { id: "desc" }],
    select: { id: true, name: true, status: true },
  });

  if (!draw) {
    return {
      hasExposure: false,
      summary:
        "ไม่มีภาระผูกพันค้างอยู่ เพราะไม่มีรอบที่ยังไม่ปิดบัญชีและมีบิลที่ยืนยันแล้ว",
      drawName: null,
      drawStatus: null,
      totalStake: "0.00",
      theoreticalMaxPayout: "0.00",
      detailsTruncated: false,
      details: [],
    };
  }

  const totals = await prisma.$queryRaw<{ stake: unknown; max_payout: unknown }[]>`
    SELECT COALESCE(SUM(bi."stake"), 0) AS stake,
           COALESCE(SUM(bi."stake" * bi."payoutRateSnapshot"), 0) AS max_payout
    FROM ${table("bill_items")} bi
    JOIN ${table("bills")} b ON b."id" = bi."billId"
    WHERE bi."organizationId" = ${actor.organizationId}
      AND b."drawId" = ${draw.id}
      AND b."status" IN (${COUNTED})
  `;

  const rows = await prisma.$queryRaw<
    {
      number: string;
      prize_type: string;
      item_count: unknown;
      stake: unknown;
      payout_if_wins: unknown;
    }[]
  >`
    SELECT bi."number" AS number,
           pt."name" AS prize_type,
           COUNT(*) AS item_count,
           SUM(bi."stake") AS stake,
           SUM(bi."stake" * bi."payoutRateSnapshot") AS payout_if_wins
    FROM ${table("bill_items")} bi
    JOIN ${table("bills")} b ON b."id" = bi."billId"
    JOIN ${table("prize_types")} pt ON pt."id" = bi."prizeTypeId"
    WHERE bi."organizationId" = ${actor.organizationId}
      AND b."drawId" = ${draw.id}
      AND b."status" IN (${COUNTED})
    GROUP BY bi."number", pt."name"
    ORDER BY payout_if_wins DESC, item_count DESC, bi."number" ASC
    LIMIT ${TOP_LIMIT + 1}
  `;

  const totalStake = Number(totals[0]?.stake ?? 0);

  const topRow = rows[0];
  return {
    hasExposure: rows.length > 0,
    summary:
      rows.length > 0
        ? `รอบ ${sanitizeLabel(draw.name)} มีภาระผูกพันค้างอยู่ เลขที่ต้องจ่ายมากที่สุดคือ ${topRow!.number} (${sanitizeLabel(topRow!.prize_type)}) ต้องจ่าย ${money(topRow!.payout_if_wins)} บาทถ้าออก`
        : `รอบ ${sanitizeLabel(draw.name)} ยังไม่มีรายการที่สร้างภาระผูกพัน`,
    drawName: sanitizeLabel(draw.name),
    drawStatus: draw.status,
    totalStake: totalStake.toFixed(2),
    theoreticalMaxPayout: money(totals[0]?.max_payout),
    detailsTruncated: rows.length > TOP_LIMIT,
    details: rows.slice(0, TOP_LIMIT).map((row, index) => ({
      rank: index + 1,
      number: row.number,
      prizeType: sanitizeLabel(row.prize_type),
      itemCount: count(row.item_count),
      stake: money(row.stake),
      payoutIfWins: money(row.payout_if_wins),
      netIfWins: (totalStake - Number(row.payout_if_wins ?? 0)).toFixed(2),
    })),
  };
}

/**
 * พฤติกรรมลูกค้า
 *
 * ลูกค้าถูกระบุด้วย bill.title ซึ่งเป็นรหัสอ้างอิงลูกค้าที่ Agent กรอก
 * ระบบไม่มีตารางลูกค้าแยก จึงนับจากรหัสนี้เป็นหลัก และถือว่ารหัสเดียวกันคือคนเดียวกัน
 */
async function buildCustomerBehavior(actor: Actor): Promise<CustomerBehavior> {
  const recentDraws = await prisma.draw.findMany({
    where: { organizationId: actor.organizationId },
    orderBy: [{ cutoffAt: "desc" }, { id: "desc" }],
    take: CHURN_DRAW_WINDOW,
    select: { id: true },
  });
  const recentDrawIds = recentDraws.map((draw) => draw.id);

  const summary = await prisma.$queryRaw<
    {
      total_customers: unknown;
      repeat_customers: unknown;
      avg_bills: unknown;
      avg_spend: unknown;
    }[]
  >`
    SELECT COUNT(*) AS total_customers,
           COUNT(*) FILTER (WHERE per_customer.bills > 1) AS repeat_customers,
           COALESCE(AVG(per_customer.bills), 0) AS avg_bills,
           COALESCE(AVG(per_customer.spend), 0) AS avg_spend
    FROM (
      SELECT b."title" AS title,
             COUNT(*) AS bills,
             SUM(b."totalStake") AS spend
      FROM ${table("bills")} b
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
      GROUP BY b."title"
    ) AS per_customer
  `;

  // ลูกค้าที่หายไป = เคยซื้อ แต่ไม่มีบิลในรอบล่าสุดที่ผ่านมาเลย
  const churned =
    recentDrawIds.length === 0
      ? [{ churned: 0 }]
      : await prisma.$queryRaw<{ churned: unknown }[]>`
          SELECT COUNT(*) AS churned
          FROM (
            SELECT b."title" AS title
            FROM ${table("bills")} b
            WHERE b."organizationId" = ${actor.organizationId}
              AND b."status" IN (${COUNTED})
            GROUP BY b."title"
            HAVING COUNT(*) FILTER (
              WHERE b."drawId" IN (${Prisma.join(recentDrawIds)})
            ) = 0
          ) AS lapsed
        `;

  const top = await prisma.$queryRaw<
    {
      customer_reference: string;
      bills: unknown;
      draws_played: unknown;
      total_spend: unknown;
      average_bill: unknown;
      total_won: unknown;
      last_seen_draw: string | null;
    }[]
  >`
    SELECT b."title" AS customer_reference,
           COUNT(DISTINCT b."id") AS bills,
           COUNT(DISTINCT b."drawId") AS draws_played,
           SUM(b."totalStake") AS total_spend,
           AVG(b."totalStake") AS average_bill,
           SUM(b."totalPayout") AS total_won,
           (
             SELECT d2."name"
             FROM ${table("bills")} b2
             JOIN ${table("draws")} d2 ON d2."id" = b2."drawId"
             WHERE b2."organizationId" = b."organizationId"
               AND b2."title" = b."title"
               AND b2."status" IN (${COUNTED})
             ORDER BY d2."cutoffAt" DESC
             LIMIT 1
           ) AS last_seen_draw
    FROM ${table("bills")} b
    WHERE b."organizationId" = ${actor.organizationId}
      AND b."status" IN (${COUNTED})
    GROUP BY b."organizationId", b."title"
    ORDER BY total_spend DESC, bills DESC, b."title" ASC
    LIMIT ${TOP_LIMIT + 1}
  `;

  return {
    totalCustomers: count(summary[0]?.total_customers),
    repeatCustomers: count(summary[0]?.repeat_customers),
    averageBillsPerCustomer: Number(summary[0]?.avg_bills ?? 0).toFixed(2),
    averageSpendPerCustomer: money(summary[0]?.avg_spend),
    churnedCustomers: count(churned[0]?.churned),
    churnWindowDraws: recentDrawIds.length,
    detailsTruncated: top.length > TOP_LIMIT,
    topCustomers: top.slice(0, TOP_LIMIT).map((row, index) => ({
      rank: index + 1,
      customerReference: sanitizeLabel(row.customer_reference),
      bills: count(row.bills),
      drawsPlayed: count(row.draws_played),
      totalSpend: money(row.total_spend),
      averageBill: money(row.average_bill),
      totalWon: money(row.total_won),
      lastSeenDraw: row.last_seen_draw ? sanitizeLabel(row.last_seen_draw) : null,
    })),
  };
}

const TREND_LIMIT = 12;

/** แนวโน้มยอดขายรายรอบ พร้อมเปอร์เซ็นต์เปลี่ยนแปลงที่คำนวณในฐานข้อมูล */
async function buildSalesTrend(actor: Actor): Promise<SalesTrend> {
  const rows = await prisma.$queryRaw<
    { draw_name: string; cutoff_at: Date; bills: unknown; sales: unknown }[]
  >`
    SELECT d."name" AS draw_name,
           d."cutoffAt" AS cutoff_at,
           COUNT(b."id") AS bills,
           COALESCE(SUM(b."totalStake"), 0) AS sales
    FROM ${table("draws")} d
    LEFT JOIN ${table("bills")} b
      ON b."drawId" = d."id"
     AND b."status" IN (${COUNTED})
    WHERE d."organizationId" = ${actor.organizationId}
    GROUP BY d."id", d."name", d."cutoffAt"
    ORDER BY d."cutoffAt" DESC
    LIMIT ${TREND_LIMIT + 1}
  `;

  const truncated = rows.length > TREND_LIMIT;
  // เรียงจากเก่าไปใหม่เพื่อให้เทียบกับรอบก่อนหน้าได้
  const ordered = rows.slice(0, TREND_LIMIT).reverse();

  const details = ordered.map((row, index) => {
    const previous = index > 0 ? Number(ordered[index - 1]!.sales ?? 0) : null;
    const current = Number(row.sales ?? 0);
    const changePercent =
      previous === null || previous === 0
        ? null
        : (((current - previous) / previous) * 100).toFixed(2);
    return {
      drawName: sanitizeLabel(row.draw_name),
      cutoffAt: row.cutoff_at.toISOString(),
      bills: count(row.bills),
      sales: current.toFixed(2),
      changeFromPreviousPercent: changePercent,
    };
  });

  let direction: SalesTrend["direction"] = "insufficient_data";
  if (details.length >= 2) {
    const first = Number(details[0]!.sales);
    const last = Number(details[details.length - 1]!.sales);
    direction = last > first ? "increasing" : last < first ? "decreasing" : "flat";
  }

  return { detailsTruncated: truncated, details, direction };
}

export async function buildOwnerAnalytics(actor: Actor): Promise<OwnerAnalytics> {
  const [riskExposure, customerBehavior, salesTrend] = await Promise.all([
    buildRiskExposure(actor),
    buildCustomerBehavior(actor),
    buildSalesTrend(actor),
  ]);
  return { riskExposure, customerBehavior, salesTrend };
}

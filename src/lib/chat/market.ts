import { Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";
import { databaseSchema, prisma } from "@/lib/db";
import { sanitizeLabel } from "./sanitize";

/**
 * มุมมองการตลาด
 *
 * ต่างจาก analytics ตรงที่ไม่ได้ตอบ "ตัวเลขเท่าไร" แต่ตอบ "สัดส่วนเป็นอย่างไร"
 * ซึ่งเป็นคำถามที่เจ้าของกิจการใช้ตัดสินใจ เช่น พึ่งลูกค้าไม่กี่รายอยู่หรือเปล่า
 * ช่องทางไหนทำรายได้จริง และสินค้าตัวไหนเป็นตัวหลัก
 *
 * ทุกสัดส่วนคำนวณใน PostgreSQL ด้วย window function ไม่ใช่ในโมเดล
 */

const COUNTED = Prisma.sql`'CONFIRMED', 'LOCKED', 'SETTLED'`;

function table(name: string): Prisma.Sql {
  const schema = databaseSchema().replace(/[^A-Za-z0-9_]/g, "");
  return Prisma.raw(`"${schema}"."${name}"`);
}

function money(value: unknown): string {
  return Number(value ?? 0).toFixed(2);
}

function percent(value: unknown): string {
  return Number(value ?? 0).toFixed(2);
}

export type MarketInsight = {
  productMix: {
    detailsTruncated: boolean;
    details: {
      rank: number;
      prizeType: string;
      stake: string;
      sharePercent: string;
      itemCount: number;
    }[];
  };
  channelMix: {
    /** ตัวแทนที่ทำยอดได้จริงในช่วงที่มีข้อมูล */
    activeAgents: number;
    details: {
      rank: number;
      agentCode: string;
      sales: string;
      sharePercent: string;
      customers: number;
    }[];
  };
  customerConcentration: {
    totalCustomers: number;
    /** สัดส่วนยอดขายที่มาจากลูกค้า 5 รายใหญ่ที่สุด ยิ่งสูงยิ่งพึ่งพาคนไม่กี่คน */
    top5SharePercent: string;
    top10SharePercent: string;
    /** ลูกค้าที่ซื้อมากกว่าหนึ่งรอบ */
    multiDrawCustomers: number;
    multiDrawSharePercent: string;
  };
  growth: {
    /** เทียบเดือนล่าสุดกับเดือนก่อนหน้า null = ข้อมูลไม่พอ */
    latestMonth: string | null;
    latestMonthSales: string | null;
    previousMonthSales: string | null;
    changePercent: string | null;
    newCustomersLatestMonth: number | null;
  };
};

async function buildProductMix(actor: Actor): Promise<MarketInsight["productMix"]> {
  const rows = await prisma.$queryRaw<
    { prize_type: string; stake: unknown; share: unknown; item_count: unknown }[]
  >`
    SELECT pt."name" AS prize_type,
           SUM(bi."stake") AS stake,
           100.0 * SUM(bi."stake") / NULLIF(SUM(SUM(bi."stake")) OVER (), 0) AS share,
           COUNT(*) AS item_count
    FROM ${table("bill_items")} bi
    JOIN ${table("bills")} b ON b."id" = bi."billId"
    JOIN ${table("prize_types")} pt ON pt."id" = bi."prizeTypeId"
    WHERE bi."organizationId" = ${actor.organizationId}
      AND b."status" IN (${COUNTED})
    GROUP BY pt."name"
    ORDER BY SUM(bi."stake") DESC
    LIMIT 9
  `;
  return {
    detailsTruncated: rows.length > 8,
    details: rows.slice(0, 8).map((row, index) => ({
      rank: index + 1,
      prizeType: sanitizeLabel(row.prize_type),
      stake: money(row.stake),
      sharePercent: percent(row.share),
      itemCount: Number(row.item_count ?? 0),
    })),
  };
}

async function buildChannelMix(actor: Actor): Promise<MarketInsight["channelMix"]> {
  const rows = await prisma.$queryRaw<
    { code: string; sales: unknown; share: unknown; customers: unknown }[]
  >`
    SELECT a."code" AS code,
           SUM(b."totalStake") AS sales,
           100.0 * SUM(b."totalStake") / NULLIF(SUM(SUM(b."totalStake")) OVER (), 0) AS share,
           COUNT(DISTINCT b."title") AS customers
    FROM ${table("bills")} b
    JOIN ${table("agents")} a ON a."id" = b."agentId"
    WHERE b."organizationId" = ${actor.organizationId}
      AND b."status" IN (${COUNTED})
    GROUP BY a."code"
    ORDER BY SUM(b."totalStake") DESC
    LIMIT 10
  `;
  return {
    activeAgents: rows.length,
    details: rows.map((row, index) => ({
      rank: index + 1,
      agentCode: row.code,
      sales: money(row.sales),
      sharePercent: percent(row.share),
      customers: Number(row.customers ?? 0),
    })),
  };
}

async function buildConcentration(
  actor: Actor,
): Promise<MarketInsight["customerConcentration"]> {
  const rows = await prisma.$queryRaw<
    {
      total_customers: unknown;
      top5_share: unknown;
      top10_share: unknown;
      multi_draw_customers: unknown;
      multi_draw_share: unknown;
    }[]
  >`
    WITH per_customer AS (
      SELECT b."title" AS title,
             SUM(b."totalStake") AS spend,
             COUNT(DISTINCT b."drawId") AS draws
      FROM ${table("bills")} b
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
      GROUP BY b."title"
    ), ranked AS (
      SELECT title, spend, draws,
             ROW_NUMBER() OVER (ORDER BY spend DESC) AS position,
             SUM(spend) OVER () AS total_spend
      FROM per_customer
    )
    SELECT COUNT(*) AS total_customers,
           100.0 * SUM(spend) FILTER (WHERE position <= 5) / NULLIF(MAX(total_spend), 0) AS top5_share,
           100.0 * SUM(spend) FILTER (WHERE position <= 10) / NULLIF(MAX(total_spend), 0) AS top10_share,
           COUNT(*) FILTER (WHERE draws > 1) AS multi_draw_customers,
           100.0 * SUM(spend) FILTER (WHERE draws > 1) / NULLIF(MAX(total_spend), 0) AS multi_draw_share
    FROM ranked
  `;
  const row = rows[0];
  return {
    totalCustomers: Number(row?.total_customers ?? 0),
    top5SharePercent: percent(row?.top5_share),
    top10SharePercent: percent(row?.top10_share),
    multiDrawCustomers: Number(row?.multi_draw_customers ?? 0),
    multiDrawSharePercent: percent(row?.multi_draw_share),
  };
}

async function buildGrowth(actor: Actor): Promise<MarketInsight["growth"]> {
  const months = await prisma.$queryRaw<{ period: string; sales: unknown }[]>`
    SELECT TO_CHAR(d."cutoffAt", 'YYYY-MM') AS period,
           COALESCE(SUM(b."totalStake"), 0) AS sales
    FROM ${table("draws")} d
    LEFT JOIN ${table("bills")} b
      ON b."drawId" = d."id"
     AND b."status" IN (${COUNTED})
    WHERE d."organizationId" = ${actor.organizationId}
    GROUP BY TO_CHAR(d."cutoffAt", 'YYYY-MM')
    ORDER BY period DESC
    LIMIT 2
  `;

  if (months.length === 0) {
    return {
      latestMonth: null,
      latestMonthSales: null,
      previousMonthSales: null,
      changePercent: null,
      newCustomersLatestMonth: null,
    };
  }

  const latest = months[0]!;
  const previous = months[1];

  // ลูกค้าใหม่ = ซื้อครั้งแรกในเดือนล่าสุด
  const newCustomers = await prisma.$queryRaw<{ count: unknown }[]>`
    SELECT COUNT(*) AS count
    FROM (
      SELECT b."title" AS title,
             MIN(TO_CHAR(d."cutoffAt", 'YYYY-MM')) AS first_month
      FROM ${table("bills")} b
      JOIN ${table("draws")} d ON d."id" = b."drawId"
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
      GROUP BY b."title"
    ) AS firsts
    WHERE firsts.first_month = ${latest.period}
  `;

  const latestSales = Number(latest.sales ?? 0);
  const previousSales = previous ? Number(previous.sales ?? 0) : null;

  return {
    latestMonth: latest.period,
    latestMonthSales: latestSales.toFixed(2),
    previousMonthSales: previousSales === null ? null : previousSales.toFixed(2),
    changePercent:
      previousSales === null || previousSales === 0
        ? null
        : (((latestSales - previousSales) / previousSales) * 100).toFixed(2),
    newCustomersLatestMonth: Number(newCustomers[0]?.count ?? 0),
  };
}

export async function buildMarketInsight(actor: Actor): Promise<MarketInsight> {
  const [productMix, channelMix, customerConcentration, growth] = await Promise.all([
    buildProductMix(actor),
    buildChannelMix(actor),
    buildConcentration(actor),
    buildGrowth(actor),
  ]);
  return { productMix, channelMix, customerConcentration, growth };
}

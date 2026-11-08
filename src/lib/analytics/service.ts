import { Prisma } from "@prisma/client";
import type { BillStatus } from "@prisma/client";
import { databaseSchema, prisma } from "@/lib/db";

type AnalyticsFilter = {
  organizationId: string;
  drawId?: string;
  agentId?: string;
  status?: BillStatus;
};

type MoneyValue = Prisma.Decimal | string | number | null;

function table(name: "bills" | "bill_items" | "prize_types" | "draws") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

function billWhere(filter: AnalyticsFilter) {
  return Prisma.sql`
    b."organizationId" = ${filter.organizationId}
    ${filter.status
      ? Prisma.sql`AND b."status"::text = ${filter.status}`
      : Prisma.sql`AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')`}
    ${filter.drawId ? Prisma.sql`AND b."drawId" = ${filter.drawId}` : Prisma.empty}
    ${filter.agentId ? Prisma.sql`AND b."agentId" = ${filter.agentId}` : Prisma.empty}
  `;
}

function number(value: MoneyValue): number {
  return Number(value ?? 0);
}

type SummaryRow = { billCount: number; totalSales: MoneyValue };
type CustomerRow = {
  label: string;
  bills: number;
  spend: MoneyValue;
  items: number;
  customerCount: number;
  repeatCustomers: number;
  loyalCustomers: number;
  occasionalCustomers: number;
  newCustomers: number;
  unknownCustomers: number;
};
type PrizeRow = { name: string; count: number; stake: MoneyValue };
type PrizeNumberRow = { prizeName: string; number: string; count: number; stake: MoneyValue };
type TimeRow = { label: string; bills: number; sales: MoneyValue };
type DrawRow = { id: string; name: string; cutoffAt: Date; bills: number; sales: MoneyValue };

/**
 * คืนเฉพาะผลสรุปที่หน้าวิเคราะห์ต้องใช้จริง
 *
 * เดิมหน้าจอนี้โหลด Bill และ BillItem ทุกแถวเข้ามาใน Node.js แล้วค่อยวนรวมค่า
 * ทำให้เวลาและหน่วยความจำโตตามจำนวนรายการโดยตรง คิวรีชุดนี้ให้ PostgreSQL รวมค่า
 * และส่งกลับมาเพียงหลักสิบแถว แม้ข้อมูลต้นทางจะมีหลายแสนรายการก็ตาม
 */
export async function getAnalyticsData(filter: AnalyticsFilter) {
  const where = billWhere(filter);
  const [summaryRows, customerRows, prizeRows, prizeNumberRows, timeRows, drawRows] = await Promise.all([
    prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
      SELECT COUNT(*)::int AS "billCount",
             COALESCE(SUM(b."totalStake"), 0) AS "totalSales"
      FROM ${table("bills")} b
      WHERE ${where}
    `),
    prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
      WITH normalized_bills AS (
        SELECT b.id,
               CASE WHEN BTRIM(b.title) = '' THEN b.id ELSE LOWER(BTRIM(b.title)) END AS key,
               CASE WHEN BTRIM(b.title) = '' THEN 'ไม่ระบุรหัส' ELSE BTRIM(b.title) END AS label,
               b."totalStake"
        FROM ${table("bills")} b
        WHERE ${where}
      ), customer_bills AS (
        SELECT nb.key, MIN(nb.label) AS label,
               COUNT(*)::int AS bills,
               COALESCE(SUM(nb."totalStake"), 0) AS spend
        FROM normalized_bills nb
        GROUP BY nb.key
      ), customer_items AS (
        SELECT nb.key,
               COUNT(i.id)::int AS items
        FROM normalized_bills nb
        JOIN ${table("bill_items")} i ON i."billId" = nb.id
        GROUP BY nb.key
      )
      SELECT cb.label, cb.bills, cb.spend, COALESCE(ci.items, 0)::int AS items,
             COUNT(*) OVER ()::int AS "customerCount",
             COUNT(*) FILTER (WHERE cb.bills > 1) OVER ()::int AS "repeatCustomers",
             COUNT(*) FILTER (WHERE cb.bills >= 3) OVER ()::int AS "loyalCustomers",
             COUNT(*) FILTER (WHERE cb.bills = 2) OVER ()::int AS "occasionalCustomers",
             COUNT(*) FILTER (WHERE cb.bills = 1) OVER ()::int AS "newCustomers",
             COUNT(*) FILTER (WHERE cb.label = 'ไม่ระบุรหัส') OVER ()::int AS "unknownCustomers"
      FROM customer_bills cb
      LEFT JOIN customer_items ci ON ci.key = cb.key
      ORDER BY cb.spend DESC, cb.bills DESC, cb.label
      LIMIT 50
    `),
    prisma.$queryRaw<PrizeRow[]>(Prisma.sql`
      SELECT pt.name,
             COUNT(i.id)::int AS count,
             COALESCE(SUM(i.stake), 0) AS stake
      FROM ${table("bills")} b
      JOIN ${table("bill_items")} i ON i."billId" = b.id
      JOIN ${table("prize_types")} pt ON pt.id = i."prizeTypeId"
      WHERE ${where}
      GROUP BY pt.id, pt.name
      ORDER BY stake DESC, count DESC
    `),
    prisma.$queryRaw<PrizeNumberRow[]>(Prisma.sql`
      WITH prize_totals AS (
        SELECT i."prizeTypeId", pt.name, COALESCE(SUM(i.stake), 0) AS "prizeStake"
        FROM ${table("bills")} b
        JOIN ${table("bill_items")} i ON i."billId" = b.id
        JOIN ${table("prize_types")} pt ON pt.id = i."prizeTypeId"
        WHERE ${where}
        GROUP BY i."prizeTypeId", pt.name
        ORDER BY "prizeStake" DESC
        LIMIT 5
      ), number_totals AS (
        SELECT i."prizeTypeId", i.number,
               COUNT(i.id)::int AS count,
               COALESCE(SUM(i.stake), 0) AS stake
        FROM ${table("bills")} b
        JOIN ${table("bill_items")} i ON i."billId" = b.id
        WHERE ${where}
          AND i."prizeTypeId" IN (SELECT "prizeTypeId" FROM prize_totals)
        GROUP BY i."prizeTypeId", i.number
      ), ranked AS (
        SELECT pt.name AS "prizeName", nt.number, nt.count, nt.stake, pt."prizeStake",
               ROW_NUMBER() OVER (PARTITION BY nt."prizeTypeId" ORDER BY nt.count DESC, nt.stake DESC, nt.number) AS rank
        FROM number_totals nt
        JOIN prize_totals pt ON pt."prizeTypeId" = nt."prizeTypeId"
      )
      SELECT "prizeName", number, count, stake
      FROM ranked
      WHERE rank <= 3
      ORDER BY "prizeStake" DESC, rank
    `),
    prisma.$queryRaw<TimeRow[]>(Prisma.sql`
      SELECT CASE
               WHEN EXTRACT(HOUR FROM b."createdAt" AT TIME ZONE 'Asia/Bangkok') < 12 THEN 'เช้า'
               WHEN EXTRACT(HOUR FROM b."createdAt" AT TIME ZONE 'Asia/Bangkok') < 17 THEN 'บ่าย'
               ELSE 'เย็น/ค่ำ'
             END AS label,
             COUNT(*)::int AS bills,
             COALESCE(SUM(b."totalStake"), 0) AS sales
      FROM ${table("bills")} b
      WHERE ${where}
      GROUP BY label
    `),
    prisma.$queryRaw<DrawRow[]>(Prisma.sql`
      SELECT d.id, d.name, d."cutoffAt",
             COUNT(*)::int AS bills,
             COALESCE(SUM(b."totalStake"), 0) AS sales
      FROM ${table("bills")} b
      JOIN ${table("draws")} d ON d.id = b."drawId"
      WHERE ${where}
      GROUP BY d.id, d.name, d."cutoffAt"
      ORDER BY d."cutoffAt" ASC
    `),
  ]);

  const summary = summaryRows[0] ?? { billCount: 0, totalSales: 0 };
  const customerSummary = customerRows[0] ?? {
    customerCount: 0,
    repeatCustomers: 0,
    loyalCustomers: 0,
    occasionalCustomers: 0,
    newCustomers: 0,
    unknownCustomers: 0,
  };

  return {
    billCount: summary.billCount,
    totalSales: number(summary.totalSales),
    customerCount: customerSummary.customerCount,
    repeatCustomers: customerSummary.repeatCustomers,
    segments: {
      loyal: customerSummary.loyalCustomers,
      occasional: customerSummary.occasionalCustomers,
      new: customerSummary.newCustomers,
      unknown: customerSummary.unknownCustomers,
    },
    customers: customerRows.map((row) => ({ label: row.label, bills: row.bills, spend: number(row.spend), items: row.items })),
    prizes: prizeRows.map((row) => ({ name: row.name, count: row.count, stake: number(row.stake) })),
    prizeNumbers: prizeNumberRows.map((row) => ({ prizeName: row.prizeName, number: row.number, count: row.count, stake: number(row.stake) })),
    times: timeRows.map((row) => ({ label: row.label, bills: row.bills, sales: number(row.sales) })),
    draws: drawRows.map((row) => ({ id: row.id, name: row.name, cutoffAt: row.cutoffAt.toISOString(), bills: row.bills, sales: number(row.sales) })),
  };
}

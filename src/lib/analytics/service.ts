import { Prisma } from "@prisma/client";
import type { BillStatus } from "@prisma/client";
import { databaseSchema, prisma } from "@/lib/db";

type AnalyticsFilter = {
  organizationId: string;
  drawId?: string;
  drawIds?: string[];
  agentId?: string;
  status?: BillStatus;
  dateFrom?: Date;
  dateTo?: Date;
};

type MoneyValue = Prisma.Decimal | string | number | null;

function table(name: "bills" | "bill_items" | "prize_types" | "draws" | "agents") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

function billWhere(filter: AnalyticsFilter) {
  const drawIds = filter.drawIds ?? (filter.drawId ? [filter.drawId] : undefined);
  return Prisma.sql`
    b."organizationId" = ${filter.organizationId}
    ${filter.status
      ? Prisma.sql`AND b."status"::text = ${filter.status}`
      : Prisma.sql`AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')`}
    ${drawIds === undefined
      ? Prisma.empty
      : drawIds.length > 0
        ? Prisma.sql`AND b."drawId" IN (${Prisma.join(drawIds)})`
        : Prisma.sql`AND FALSE`}
    ${filter.agentId ? Prisma.sql`AND b."agentId" = ${filter.agentId}` : Prisma.empty}
    ${filter.dateFrom ? Prisma.sql`AND b."createdAt" >= ${filter.dateFrom}` : Prisma.empty}
    ${filter.dateTo ? Prisma.sql`AND b."createdAt" <= ${filter.dateTo}` : Prisma.empty}
  `;
}

function number(value: MoneyValue): number {
  return Number(value ?? 0);
}

type SummaryRow = { billCount: number; totalSales: MoneyValue };
type CustomerRow = {
  label: string;
  name: string;
  agentCode: string;
  bills: number;
  spend: MoneyValue;
  items: number;
  customerCount: number;
  repeatCustomers: number;
  loyalCustomers: number;
  occasionalCustomers: number;
  newCustomers: number;
  unknownBills: number;
  namedSales: MoneyValue;
};
type PrizeRow = { id: string; name: string; lotteryType: string; count: number; stake: MoneyValue };
type PrizeNumberRow = { prizeTypeId: string; prizeName: string; lotteryType: string; number: string; count: number; stake: MoneyValue };

const LOTTERY_LABEL: Record<string, string> = { THAI_GOVERNMENT: "หวยรัฐบาล", LAO: "หวยลาว", LAO_SET: "หวยลาวชุด" };
/** ชื่อประเภทรางวัลซ้ำกันข้ามประเภทหวย (เช่น 2 ตัวบน) ต้องบอกประเภทหวยกำกับเสมอ */
export function prizeLabel(lotteryType: string, name: string): string {
  return `${LOTTERY_LABEL[lotteryType] ?? lotteryType} · ${name}`;
}

/**
 * ตัวระบุลูกค้า: Agent + ชื่อที่ทำความสะอาดแล้ว
 * - Agent สองคนที่มีลูกค้าชื่อ "สมชาย" นับเป็นคนละคน
 * - "สมชาย", " สมชาย ", "คุณสมชาย", "สมชาย  ใจดี" (เว้นวรรคซ้ำ) นับเป็นคนเดียวกัน
 * - บิลที่ไม่มีชื่อไม่นับเป็นลูกค้า และไม่อยู่ในตัวหารอัตราซื้อซ้ำ
 * ยังไม่ใช่รหัสลูกค้าจริง ถ้าต้องแม่นยำ 100% ต้องเพิ่มตารางลูกค้า (customerId) ในอนาคต
 */
function customerNameSql(column: Prisma.Sql) {
  // ตัดคำว่า "คุณ" นำหน้าเฉพาะเมื่อตัวถัดไปขึ้นต้นคำได้ ชื่ออย่าง "คุณากร" (ตามด้วยสระ) จึงไม่ถูกตัด
  return Prisma.sql`LOWER(REGEXP_REPLACE(REGEXP_REPLACE(BTRIM(${column}), '^คุณ(?![ะาำิีึืุูั็่้๊๋์ๅ])\\s*', ''), '\\s+', ' ', 'g'))`;
}
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
        SELECT b.id, b."agentId",
               ${customerNameSql(Prisma.sql`b.title`)} AS name_key,
               BTRIM(b.title) AS label,
               b."totalStake"
        FROM ${table("bills")} b
        WHERE ${where}
      ), named_bills AS (
        SELECT * FROM normalized_bills WHERE name_key <> ''
      ), customer_bills AS (
        SELECT nb."agentId", nb.name_key, MIN(nb.label) AS label,
               COUNT(*)::int AS bills,
               COALESCE(SUM(nb."totalStake"), 0) AS spend
        FROM named_bills nb
        GROUP BY nb."agentId", nb.name_key
      ), customer_items AS (
        SELECT nb."agentId", nb.name_key, COUNT(i.id)::int AS items
        FROM named_bills nb
        JOIN ${table("bill_items")} i ON i."billId" = nb.id
        GROUP BY nb."agentId", nb.name_key
      ), extras AS (
        SELECT COUNT(*) FILTER (WHERE name_key = '')::int AS "unknownBills"
        FROM normalized_bills
      )
      SELECT cb.label || ' · ' || a.code AS label, cb.label AS name, a.code AS "agentCode",
             cb.bills, cb.spend, COALESCE(ci.items, 0)::int AS items,
             COUNT(*) OVER ()::int AS "customerCount",
             COUNT(*) FILTER (WHERE cb.bills > 1) OVER ()::int AS "repeatCustomers",
             COUNT(*) FILTER (WHERE cb.bills >= 3) OVER ()::int AS "loyalCustomers",
             COUNT(*) FILTER (WHERE cb.bills = 2) OVER ()::int AS "occasionalCustomers",
             COUNT(*) FILTER (WHERE cb.bills = 1) OVER ()::int AS "newCustomers",
             (SELECT "unknownBills" FROM extras) AS "unknownBills",
             SUM(cb.spend) OVER () AS "namedSales"
      FROM customer_bills cb
      JOIN ${table("agents")} a ON a.id = cb."agentId"
      LEFT JOIN customer_items ci ON ci."agentId" = cb."agentId" AND ci.name_key = cb.name_key
      ORDER BY cb.spend DESC, cb.bills DESC, cb.label
      LIMIT 50
    `),
    prisma.$queryRaw<PrizeRow[]>(Prisma.sql`
      SELECT pt.id, pt.name, pt."lotteryType"::text AS "lotteryType",
             COUNT(i.id)::int AS count,
             COALESCE(SUM(i.stake), 0) AS stake
      FROM ${table("bills")} b
      JOIN ${table("bill_items")} i ON i."billId" = b.id
      JOIN ${table("prize_types")} pt ON pt.id = i."prizeTypeId"
      WHERE ${where}
      GROUP BY pt.id, pt.name, pt."lotteryType"
      ORDER BY stake DESC, count DESC
    `),
    prisma.$queryRaw<PrizeNumberRow[]>(Prisma.sql`
      WITH number_totals AS (
        SELECT i."prizeTypeId", i.number,
               COUNT(i.id)::int AS count,
               COALESCE(SUM(i.stake), 0) AS stake
        FROM ${table("bills")} b
        JOIN ${table("bill_items")} i ON i."billId" = b.id
        WHERE ${where}
        GROUP BY i."prizeTypeId", i.number
      ), ranked AS (
        SELECT nt."prizeTypeId", pt.name AS "prizeName", pt."lotteryType"::text AS "lotteryType",
               nt.number, nt.count, nt.stake,
               ROW_NUMBER() OVER (PARTITION BY nt."prizeTypeId" ORDER BY nt.stake DESC, nt.count DESC, nt.number) AS rank
        FROM number_totals nt
        JOIN ${table("prize_types")} pt ON pt.id = nt."prizeTypeId"
      )
      SELECT "prizeTypeId", "prizeName", "lotteryType", number, count, stake
      FROM ranked
      WHERE rank <= 5
      ORDER BY stake DESC, count DESC, number
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
    unknownBills: 0,
    namedSales: 0,
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
    },
    /** บิลที่ไม่ระบุชื่อลูกค้า ไม่นับเป็นลูกค้าและไม่อยู่ในตัวหารอัตราซื้อซ้ำ */
    unknownBills: customerSummary.unknownBills,
    /** ยอดขายของบิลที่ระบุลูกค้า ใช้คิดส่วนแบ่งยอดขายของลูกค้ารายใหญ่ */
    namedSales: number(customerSummary.namedSales),
    customers: customerRows.map((row) => ({ label: row.label, name: row.name, agentCode: row.agentCode, bills: row.bills, spend: number(row.spend), items: row.items })),
    prizes: prizeRows.map((row) => ({ id: row.id, label: prizeLabel(row.lotteryType, row.name), count: row.count, stake: number(row.stake) })),
    /** เลขยอดนิยม ≤ 5 อันดับต่อประเภทรางวัล เรียงจากยอดรับมากสุดของทั้งหมด แถวแรก ๆ จึงเป็นเลขที่รับยอดสูงสุด */
    prizeNumbers: prizeNumberRows.map((row) => ({ prizeTypeId: row.prizeTypeId, prizeLabel: prizeLabel(row.lotteryType, row.prizeName), number: row.number, count: row.count, stake: number(row.stake) })),
    times: timeRows.map((row) => ({ label: row.label, bills: row.bills, sales: number(row.sales) })),
    draws: drawRows.map((row) => ({ id: row.id, name: row.name, cutoffAt: row.cutoffAt.toISOString(), bills: row.bills, sales: number(row.sales) })),
  };
}

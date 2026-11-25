import { Prisma } from "@prisma/client";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { databaseSchema, prisma } from "@/lib/db";
import { drawFilterSql, type DrawFilter } from "@/lib/draws/range";

const CUSTOMER_PREVIEW_LIMIT = 6;

type MoneyValue = Prisma.Decimal | string | number | null;

function table(name: "agents" | "bills" | "draws" | "settlements" | "users") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

function billWhere(actor: Actor, draws: DrawFilter) {
  return Prisma.sql`
    b."organizationId" = ${actor.organizationId}
    AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
    ${drawFilterSql(Prisma.sql`b."drawId"`, draws)}
  `;
}

function settlementWhere(actor: Actor, draws: DrawFilter) {
  return Prisma.sql`
    s."organizationId" = ${actor.organizationId}
    ${drawFilterSql(Prisma.sql`s."drawId"`, draws)}
  `;
}

function number(value: MoneyValue): number {
  return Number(value ?? 0);
}

type StatRow = {
  agentId: string;
  sales: MoneyValue;
  billCount: number;
  payout: MoneyValue;
  thaiCommission: MoneyValue;
  laoCommission: MoneyValue;
  commission: MoneyValue;
  net: MoneyValue;
};

type CustomerRow = {
  agentId: string;
  key: string;
  name: string;
  billCount: number;
  gross: MoneyValue;
  customerCount: number;
};

/** โหลดเฉพาะผลรวมและลูกค้าที่ต้องวาดบนผัง ไม่โหลดบิลทุกใบเข้าหน่วยความจำ */
/** draws: id งวดเดียว, รายการ id (ช่วงวันที่) หรือ undefined = ทุกงวด */
export async function getOrganizationMapData(actor: Actor, draws?: DrawFilter) {
  requirePermission(actor, "report.viewAllAgents");
  const [agents, stats, topCustomers] = await Promise.all([
    prisma.agent.findMany({
      where: {
        ...orgScope(actor),
        // Agent ที่ผูกกับบัญชีซึ่ง Owner ลบแล้วต้องหายจากภาพรวม
        // ส่วน Agent เก่าที่ไม่ได้ผูกบัญชียังแสดงตามเดิม
        OR: [{ userId: null }, { user: { deletedAt: null } }],
      },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, status: true, commissionRate: true, laoCommissionRate: true },
    }),
    prisma.$queryRaw<StatRow[]>(Prisma.sql`
      WITH bill_agg AS (
        SELECT b."agentId", COUNT(*)::int AS "billCount",
               COALESCE(SUM(b."totalStake"), 0) AS sales
        FROM ${table("bills")} b
        WHERE ${billWhere(actor, draws)}
        GROUP BY b."agentId"
      ), settlement_agg AS (
        SELECT s."agentId",
               COALESCE(SUM(s.payout), 0) AS payout,
               COALESCE(SUM(CASE WHEN d."lotteryType" = 'THAI_GOVERNMENT' THEN s.commission ELSE 0 END), 0) AS "thaiCommission",
               COALESCE(SUM(CASE WHEN d."lotteryType" IN ('LAO', 'LAO_SET') THEN s.commission ELSE 0 END), 0) AS "laoCommission",
               COALESCE(SUM(s.commission), 0) AS commission,
               COALESCE(SUM(s.net), 0) AS net
        FROM ${table("settlements")} s
        INNER JOIN ${table("draws")} d
          ON d.id = s."drawId" AND d."organizationId" = s."organizationId"
        WHERE ${settlementWhere(actor, draws)}
        GROUP BY s."agentId"
      )
      SELECT a.id AS "agentId",
             COALESCE(ba.sales, 0) AS sales,
             COALESCE(ba."billCount", 0)::int AS "billCount",
             COALESCE(sa.payout, 0) AS payout,
             COALESCE(sa."thaiCommission", 0) AS "thaiCommission",
             COALESCE(sa."laoCommission", 0) AS "laoCommission",
             COALESCE(sa.commission, 0) AS commission,
             COALESCE(sa.net, 0) AS net
      FROM ${table("agents")} a
      LEFT JOIN ${table("users")} u ON u.id = a."userId"
      LEFT JOIN bill_agg ba ON ba."agentId" = a.id
      LEFT JOIN settlement_agg sa ON sa."agentId" = a.id
      WHERE a."organizationId" = ${actor.organizationId}
        AND (a."userId" IS NULL OR u."deletedAt" IS NULL)
    `),
    prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
      WITH normalized_bills AS (
        SELECT b."agentId",
               CASE WHEN BTRIM(b.title) = '' THEN 'ไม่ระบุชื่อ' ELSE LOWER(BTRIM(b.title)) END AS key,
               CASE WHEN BTRIM(b.title) = '' THEN 'ไม่ระบุชื่อ' ELSE BTRIM(b.title) END AS name,
               b."totalStake"
        FROM ${table("bills")} b
        INNER JOIN ${table("agents")} a
          ON a.id = b."agentId" AND a."organizationId" = b."organizationId"
        LEFT JOIN ${table("users")} u ON u.id = a."userId"
        WHERE ${billWhere(actor, draws)}
          AND (a."userId" IS NULL OR u."deletedAt" IS NULL)
      ), customers AS (
        SELECT nb."agentId", nb.key, MIN(nb.name) AS name,
               COUNT(*)::int AS "billCount",
               COALESCE(SUM(nb."totalStake"), 0) AS gross
        FROM normalized_bills nb
        GROUP BY nb."agentId", nb.key
      ), ranked AS (
        SELECT *,
               COUNT(*) OVER (PARTITION BY "agentId")::int AS "customerCount",
               ROW_NUMBER() OVER (PARTITION BY "agentId" ORDER BY gross DESC, "billCount" DESC, name) AS rank
        FROM customers
      )
      SELECT "agentId", key, name, "billCount", gross, "customerCount"
      FROM ranked
      WHERE rank <= ${CUSTOMER_PREVIEW_LIMIT}
      ORDER BY "agentId", rank
    `),
  ]);

  return {
    agents,
    stats: stats.map((row) => ({
      agentId: row.agentId,
      sales: number(row.sales),
      billCount: row.billCount,
      payout: number(row.payout),
      thaiCommission: number(row.thaiCommission),
      laoCommission: number(row.laoCommission),
      commission: number(row.commission),
      net: number(row.net),
    })),
    topCustomers: topCustomers.map((row) => ({
      agentId: row.agentId,
      key: row.key,
      name: row.name,
      billCount: row.billCount,
      gross: number(row.gross),
      customerCount: row.customerCount,
    })),
  };
}

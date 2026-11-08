import { Prisma } from "@prisma/client";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { databaseSchema, prisma } from "@/lib/db";

const CUSTOMER_PREVIEW_LIMIT = 6;

type MoneyValue = Prisma.Decimal | string | number | null;

function table(name: "agents" | "bills" | "settlements") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

function billWhere(actor: Actor, drawId?: string) {
  return Prisma.sql`
    b."organizationId" = ${actor.organizationId}
    AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
    ${drawId ? Prisma.sql`AND b."drawId" = ${drawId}` : Prisma.empty}
  `;
}

function settlementWhere(actor: Actor, drawId?: string) {
  return Prisma.sql`
    s."organizationId" = ${actor.organizationId}
    ${drawId ? Prisma.sql`AND s."drawId" = ${drawId}` : Prisma.empty}
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
export async function getOrganizationMapData(actor: Actor, drawId?: string) {
  requirePermission(actor, "report.viewAllAgents");
  const [agents, stats, topCustomers] = await Promise.all([
    prisma.agent.findMany({
      where: orgScope(actor),
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, status: true, commissionRate: true },
    }),
    prisma.$queryRaw<StatRow[]>(Prisma.sql`
      WITH bill_agg AS (
        SELECT b."agentId", COUNT(*)::int AS "billCount",
               COALESCE(SUM(b."totalStake"), 0) AS sales
        FROM ${table("bills")} b
        WHERE ${billWhere(actor, drawId)}
        GROUP BY b."agentId"
      ), settlement_agg AS (
        SELECT s."agentId",
               COALESCE(SUM(s.payout), 0) AS payout,
               COALESCE(SUM(s.commission), 0) AS commission,
               COALESCE(SUM(s.net), 0) AS net
        FROM ${table("settlements")} s
        WHERE ${settlementWhere(actor, drawId)}
        GROUP BY s."agentId"
      )
      SELECT a.id AS "agentId",
             COALESCE(ba.sales, 0) AS sales,
             COALESCE(ba."billCount", 0)::int AS "billCount",
             COALESCE(sa.payout, 0) AS payout,
             COALESCE(sa.commission, 0) AS commission,
             COALESCE(sa.net, 0) AS net
      FROM ${table("agents")} a
      LEFT JOIN bill_agg ba ON ba."agentId" = a.id
      LEFT JOIN settlement_agg sa ON sa."agentId" = a.id
      WHERE a."organizationId" = ${actor.organizationId}
    `),
    prisma.$queryRaw<CustomerRow[]>(Prisma.sql`
      WITH normalized_bills AS (
        SELECT b."agentId",
               CASE WHEN BTRIM(b.title) = '' THEN 'ไม่ระบุชื่อ' ELSE LOWER(BTRIM(b.title)) END AS key,
               CASE WHEN BTRIM(b.title) = '' THEN 'ไม่ระบุชื่อ' ELSE BTRIM(b.title) END AS name,
               b."totalStake"
        FROM ${table("bills")} b
        WHERE ${billWhere(actor, drawId)}
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

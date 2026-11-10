import { Prisma } from "@prisma/client";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { databaseSchema, prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { drawFilterSql, type DrawFilter } from "@/lib/draws/range";

type CustomerQueryRow = {
  agentId: string;
  agentCode: string;
  agentName: string;
  key: string;
  name: string;
  billCount: number;
  gross: Prisma.Decimal | string;
  payout: Prisma.Decimal | string;
  lastBillAt: Date;
};

function table(name: "agents" | "bills") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

async function queryCustomers(actor: Actor, agentId?: string, draws?: DrawFilter) {
  const rows = await prisma.$queryRaw<CustomerQueryRow[]>(Prisma.sql`
    WITH normalized AS (
      SELECT b."agentId",
             CASE WHEN BTRIM(b.title) = '' THEN 'ไม่ระบุชื่อ' ELSE LOWER(BTRIM(b.title)) END AS key,
             CASE WHEN BTRIM(b.title) = '' THEN 'ไม่ระบุชื่อ' ELSE BTRIM(b.title) END AS name,
             b."totalStake", b."totalPayout", b."createdAt"
      FROM ${table("bills")} b
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
        ${agentId ? Prisma.sql`AND b."agentId" = ${agentId}` : Prisma.empty}
        ${drawFilterSql(Prisma.sql`b."drawId"`, draws)}
    )
    SELECT n."agentId", a.code AS "agentCode", a.name AS "agentName",
           n.key, MIN(n.name) AS name,
           COUNT(*)::int AS "billCount",
           COALESCE(SUM(n."totalStake"), 0) AS gross,
           COALESCE(SUM(n."totalPayout"), 0) AS payout,
           MAX(n."createdAt") AS "lastBillAt"
    FROM normalized n
    JOIN ${table("agents")} a ON a.id = n."agentId"
    GROUP BY n."agentId", a.code, a.name, n.key
    ORDER BY a.code, gross DESC, "billCount" DESC, name
  `);

  return rows.map((row) => ({
    agentId: row.agentId,
    agentCode: row.agentCode,
    agentName: row.agentName,
    key: row.key,
    name: row.name,
    billCount: row.billCount,
    gross: Number(row.gross),
    payout: Number(row.payout),
    lastBillAt: row.lastBillAt,
  }));
}

export async function listAgentCustomers(actor: Actor, agentId: string, drawId?: string) {
  requirePermission(actor, "report.viewAllAgents");
  const scope = orgScope(actor);
  const agent = await prisma.agent.findFirst({
    where: { ...scope, id: agentId },
    select: { id: true, code: true, name: true },
  });
  if (!agent) throw new NotFoundError("ไม่พบ Agent");

  const rows = await queryCustomers(actor, agent.id, drawId);

  return {
    agent,
    customers: rows.map((row) => ({
      key: row.key,
      name: row.name,
      billCount: row.billCount,
      gross: row.gross,
      payout: row.payout,
      lastBillAt: row.lastBillAt,
    })),
  };
}

/** ใช้ตอนผู้ใช้กดส่งออกเท่านั้น จึงไม่เพิ่ม payload ให้หน้าแผนผัง */
export async function listOrganizationCustomers(actor: Actor, draws?: DrawFilter) {
  requirePermission(actor, "report.viewAllAgents");
  return queryCustomers(actor, undefined, draws);
}

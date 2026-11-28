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

/** อัตราที่ไม่ซ้ำกัน เรียงจากน้อยไปมาก เพื่อให้ข้อความที่แสดงคงที่ */
function rates(values: MoneyValue[] | null): number[] {
  return [...new Set((values ?? []).map((value) => Number(value ?? 0)))].sort((a, b) => a - b);
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
  /** ยอดขายเฉพาะงวดที่คำนวณ Settlement แล้ว */
  thaiSettledGross: MoneyValue;
  laoSettledGross: MoneyValue;
  /** จำนวนงวดที่ยอดถึงเกณฑ์โปรโมชั่นและได้เรตพิเศษจริง */
  thaiPromotionDraws: number;
  laoPromotionDraws: number;
  settledDraws: number;
  /**
   * อัตราที่ใช้จริง แยกเป็นเรตปกติกับเรตโปรโมชั่น
   *
   * เก็บเป็นรายการของอัตราที่ไม่ซ้ำกัน ไม่ใช่ค่าเฉลี่ย เพราะค่าเฉลี่ยถ่วงน้ำหนัก
   * เป็นตัวเลขที่ไม่ปรากฏในข้อตกลงกับใครเลยและกระทบยอดด้วยมือไม่ได้
   * ตั้ง 32 ไว้ก็ต้องเห็น 32 ไม่ใช่ 31.97
   */
  thaiBaseRates: number[];
  thaiPromotionRates: number[];
  laoBaseRates: number[];
  laoPromotionRates: number[];
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
      select: {
        id: true, code: true, name: true, status: true, commissionRate: true, laoCommissionRate: true,
        commissionPromotionStartsOn: true,
        commissionPromotionEndsOn: true,
        commissionPromotionThaiMinGross: true,
        commissionPromotionLaoMinGross: true,
        commissionPromotionThaiRate: true,
        commissionPromotionLaoRate: true,
      },
    }),
    prisma.$queryRaw<StatRow[]>(Prisma.sql`
      WITH bill_agg AS (
        SELECT b."agentId", COUNT(*)::int AS "billCount",
               COALESCE(SUM(b."totalStake"), 0) AS sales
        FROM ${table("bills")} b
        WHERE ${billWhere(actor, draws)}
        GROUP BY b."agentId"
      ), settlement_agg AS (
        /*
         * ยอดขายและจำนวนงวดที่เข้าโปรโมชั่นต้องนับจากฝั่ง Settlement ไม่ใช่ฝั่งบิล
         *
         * เกณฑ์โปรโมชั่นคิดทีละงวด ส่วนยอดขายในตารางเป็นผลรวมหลายงวด
         * เอายอดรวมไปเทียบเกณฑ์ตรง ๆ จะบอกว่าเข้าโปรฯ ทั้งที่ไม่มีงวดไหนถึงเลย
         * ธงที่ Settlement เก็บไว้ตอนคำนวณจึงเป็นคำตอบเดียวที่เชื่อได้
         */
        SELECT s."agentId",
               COALESCE(SUM(s.payout), 0) AS payout,
               COALESCE(SUM(CASE WHEN d."lotteryType" = 'THAI_GOVERNMENT' THEN s.commission ELSE 0 END), 0) AS "thaiCommission",
               COALESCE(SUM(CASE WHEN d."lotteryType" IN ('LAO', 'LAO_SET') THEN s.commission ELSE 0 END), 0) AS "laoCommission",
               COALESCE(SUM(CASE WHEN d."lotteryType" = 'THAI_GOVERNMENT' THEN s.gross ELSE 0 END), 0) AS "thaiSettledGross",
               COALESCE(SUM(CASE WHEN d."lotteryType" IN ('LAO', 'LAO_SET') THEN s.gross ELSE 0 END), 0) AS "laoSettledGross",
               COUNT(*) FILTER (WHERE s."commissionPromotionApplied" AND d."lotteryType" = 'THAI_GOVERNMENT')::int AS "thaiPromotionDraws",
               COUNT(*) FILTER (WHERE s."commissionPromotionApplied" AND d."lotteryType" IN ('LAO', 'LAO_SET'))::int AS "laoPromotionDraws",
               COUNT(*)::int AS "settledDraws",
               COALESCE(ARRAY_AGG(DISTINCT s."commissionRateSnapshot") FILTER (WHERE NOT s."commissionPromotionApplied" AND d."lotteryType" = 'THAI_GOVERNMENT'), '{}') AS "thaiBaseRates",
               COALESCE(ARRAY_AGG(DISTINCT s."commissionRateSnapshot") FILTER (WHERE s."commissionPromotionApplied" AND d."lotteryType" = 'THAI_GOVERNMENT'), '{}') AS "thaiPromotionRates",
               COALESCE(ARRAY_AGG(DISTINCT s."commissionRateSnapshot") FILTER (WHERE NOT s."commissionPromotionApplied" AND d."lotteryType" IN ('LAO', 'LAO_SET')), '{}') AS "laoBaseRates",
               COALESCE(ARRAY_AGG(DISTINCT s."commissionRateSnapshot") FILTER (WHERE s."commissionPromotionApplied" AND d."lotteryType" IN ('LAO', 'LAO_SET')), '{}') AS "laoPromotionRates",
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
             COALESCE(sa."thaiSettledGross", 0) AS "thaiSettledGross",
             COALESCE(sa."laoSettledGross", 0) AS "laoSettledGross",
             COALESCE(sa."thaiPromotionDraws", 0)::int AS "thaiPromotionDraws",
             COALESCE(sa."laoPromotionDraws", 0)::int AS "laoPromotionDraws",
             COALESCE(sa."settledDraws", 0)::int AS "settledDraws",
             COALESCE(sa."thaiBaseRates", '{}') AS "thaiBaseRates",
             COALESCE(sa."thaiPromotionRates", '{}') AS "thaiPromotionRates",
             COALESCE(sa."laoBaseRates", '{}') AS "laoBaseRates",
             COALESCE(sa."laoPromotionRates", '{}') AS "laoPromotionRates",
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
      thaiSettledGross: number(row.thaiSettledGross),
      laoSettledGross: number(row.laoSettledGross),
      thaiPromotionDraws: row.thaiPromotionDraws,
      laoPromotionDraws: row.laoPromotionDraws,
      settledDraws: row.settledDraws,
      thaiBaseRates: rates(row.thaiBaseRates),
      thaiPromotionRates: rates(row.thaiPromotionRates),
      laoBaseRates: rates(row.laoBaseRates),
      laoPromotionRates: rates(row.laoPromotionRates),
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

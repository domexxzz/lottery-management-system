import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { Actor } from "@/lib/auth/context";
import { databaseSchema, prisma } from "@/lib/db";
import { sanitizeLabel } from "./sanitize";

/**
 * ชุดคำถามที่ผู้ช่วยเรียกใช้เองได้ เพื่อดึงข้อมูลจริงมาตอบ
 *
 * ทำไมไม่ให้โมเดลเขียน SQL เอง
 *
 * ความปลอดภัยทั้งระบบตั้งอยู่บนการจำกัดขอบเขตด้วย organizationId
 * ถ้าโมเดลเขียน SQL ได้อิสระ มันข้ามขอบเขตนั้นได้ในบรรทัดเดียว
 * และไม่มีทางทดสอบล่วงหน้าได้ว่าคิวรีที่มันจะเขียนครั้งหน้าปลอดภัยหรือไม่
 *
 * ที่นี่จึงกลับด้าน: คิวรีเขียนไว้ล่วงหน้าและผูกขอบเขตไว้แน่น
 * โมเดลมีหน้าที่เลือกว่าจะใช้อันไหนและใส่พารามิเตอร์อะไร
 * ผลที่ได้เหมือนกันสำหรับผู้ใช้ — ถามเป็นภาษาไทยแล้วได้ข้อมูลจริง
 * แต่ขอบเขตองค์กรรั่วไม่ได้เลย เพราะไม่มีเส้นทางให้รั่ว
 *
 * ทุกการคำนวณเกิดใน PostgreSQL ไม่ใช่ในโมเดล และไม่มีข้อความจากผู้ใช้
 * ถูกต่อเข้าไปใน SQL แม้แต่ตัวอักษรเดียว — พารามิเตอร์ผ่าน zod แล้วผูกด้วย Prisma
 */

const COUNTED = Prisma.sql`'CONFIRMED', 'LOCKED', 'SETTLED'`;

function table(name: string): Prisma.Sql {
  const schema = databaseSchema().replace(/[^A-Za-z0-9_]/g, "");
  return Prisma.raw(`"${schema}"."${name}"`);
}

function money(value: unknown): string {
  return Number(value ?? 0).toFixed(2);
}

function num(value: unknown): number {
  return Number(value ?? 0);
}

/** เพดานแถวที่ส่งกลับ กันไม่ให้ผลลัพธ์ล้น prompt และกันคิวรีหนักเกินไป */
const MAX_LIMIT = 25;
const limitSchema = z.coerce.number().int().min(1).max(MAX_LIMIT).default(10);

export type QueryResult = {
  tool: string;
  params: Record<string, unknown>;
  /** จำนวนแถวที่ได้จริง 0 = ไม่มีข้อมูล ต้องบอกผู้ใช้ตรง ๆ ห้ามเดาแทน */
  rowCount: number;
  /** ช่วงข้อมูลที่คิวรีนี้ครอบคลุม ใช้ตรวจว่าตอบตรงกับที่ถามหรือไม่ */
  coverage: string;
  rows: Record<string, unknown>[];
};

type ToolDefinition = {
  name: string;
  /** คำอธิบายที่ส่งให้โมเดลใช้เลือก เขียนด้วยคำที่ผู้ใช้จริงพูด */
  description: string;
  schema: z.ZodType;
  run: (actor: Actor, params: never) => Promise<{ coverage: string; rows: Record<string, unknown>[] }>;
};

function define<S extends z.ZodType>(definition: {
  name: string;
  description: string;
  schema: S;
  run: (
    actor: Actor,
    params: z.infer<S>,
  ) => Promise<{ coverage: string; rows: Record<string, unknown>[] }>;
}): ToolDefinition {
  return definition as unknown as ToolDefinition;
}

// ---------------------------------------------------------------- คิวรี

const drawProfitRanking = define({
  name: "draw_profit_ranking",
  description:
    "จัดอันดับรอบตามกำไรขาดทุนสุทธิ (net) ใช้ตอบ รอบไหนกำไรสุด รอบไหนขาดทุนสุด เทียบกำไรรายงวด อันดับกำไร",
  schema: z.object({
    order: z.enum(["best", "worst"]).default("best"),
    limit: limitSchema,
  }),
  async run(actor, params) {
    const rows = await prisma.$queryRaw<
      { draw_name: string; cutoff_at: Date; gross: unknown; payout: unknown; commission: unknown; net: unknown }[]
    >`
      SELECT d."name" AS draw_name,
             d."cutoffAt" AS cutoff_at,
             SUM(s."gross") AS gross,
             SUM(s."payout") AS payout,
             SUM(s."commission") AS commission,
             SUM(s."net") AS net
      FROM ${table("settlements")} s
      JOIN ${table("draws")} d ON d."id" = s."drawId"
      WHERE s."organizationId" = ${actor.organizationId}
      GROUP BY d."id", d."name", d."cutoffAt"
      ORDER BY SUM(s."net") ${params.order === "best" ? Prisma.raw("DESC") : Prisma.raw("ASC")}
      LIMIT ${params.limit}
    `;
    return {
      coverage: "ทุกรอบที่คำนวณ Settlement แล้ว รอบที่ยังไม่คำนวณไม่อยู่ในผลนี้",
      rows: rows.map((row, index) => ({
        rank: index + 1,
        drawName: sanitizeLabel(row.draw_name),
        cutoffAt: row.cutoff_at.toISOString(),
        sales: money(row.gross),
        prizeExpense: money(row.payout),
        commission: money(row.commission),
        net: money(row.net),
      })),
    };
  },
});

const customerRanking = define({
  name: "customer_ranking",
  description:
    "จัดอันดับลูกค้า ใช้ตอบ ลูกค้าคนไหนซื้อเยอะสุด ลูกค้ารายใหญ่ ใครซื้อบ่อยสุด ใครถูกรางวัลมากสุด",
  schema: z.object({
    metric: z.enum(["spend", "bills", "winnings"]).default("spend"),
    limit: limitSchema,
  }),
  async run(actor, params) {
    const orderBy =
      params.metric === "bills"
        ? Prisma.raw('COUNT(*)')
        : params.metric === "winnings"
          ? Prisma.raw('SUM(b."totalPayout")')
          : Prisma.raw('SUM(b."totalStake")');
    const rows = await prisma.$queryRaw<
      {
        customer_reference: string;
        bills: unknown;
        draws_played: unknown;
        spend: unknown;
        avg_bill: unknown;
        winnings: unknown;
      }[]
    >`
      SELECT b."title" AS customer_reference,
             COUNT(*) AS bills,
             COUNT(DISTINCT b."drawId") AS draws_played,
             SUM(b."totalStake") AS spend,
             AVG(b."totalStake") AS avg_bill,
             SUM(b."totalPayout") AS winnings
      FROM ${table("bills")} b
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
      GROUP BY b."title"
      ORDER BY ${orderBy} DESC, b."title" ASC
      LIMIT ${params.limit}
    `;
    return {
      coverage: "ลูกค้าทุกรายจากบิลที่ยืนยันแล้วทุกรอบ ระบุด้วยรหัสอ้างอิงลูกค้าในบิล",
      rows: rows.map((row, index) => ({
        rank: index + 1,
        customerReference: sanitizeLabel(row.customer_reference),
        bills: num(row.bills),
        drawsPlayed: num(row.draws_played),
        totalSpend: money(row.spend),
        averageBill: money(row.avg_bill),
        totalWinnings: money(row.winnings),
      })),
    };
  },
});

const customerDetail = define({
  name: "customer_detail",
  description:
    "ดูประวัติของลูกค้าหนึ่งราย ใช้เมื่อผู้ใช้ระบุชื่อหรือรหัสลูกค้า เช่น ลูกค้าคนนี้ซื้ออะไรบ้าง เคยถูกรางวัลไหม",
  schema: z.object({
    customerReference: z.string().trim().min(1).max(120),
    limit: limitSchema,
  }),
  async run(actor, params) {
    const rows = await prisma.$queryRaw<
      {
        draw_name: string;
        cutoff_at: Date;
        bill_number: string | null;
        stake: unknown;
        payout: unknown;
        items: unknown;
      }[]
    >`
      SELECT d."name" AS draw_name,
             d."cutoffAt" AS cutoff_at,
             b."billNumber" AS bill_number,
             b."totalStake" AS stake,
             b."totalPayout" AS payout,
             (SELECT COUNT(*) FROM ${table("bill_items")} bi WHERE bi."billId" = b."id") AS items
      FROM ${table("bills")} b
      JOIN ${table("draws")} d ON d."id" = b."drawId"
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
        AND b."title" = ${params.customerReference}
      ORDER BY d."cutoffAt" DESC
      LIMIT ${params.limit}
    `;
    return {
      coverage: `บิลที่ยืนยันแล้วของลูกค้า ${sanitizeLabel(params.customerReference)} เรียงจากรอบล่าสุด`,
      rows: rows.map((row) => ({
        drawName: sanitizeLabel(row.draw_name),
        cutoffAt: row.cutoff_at.toISOString(),
        billNumber: row.bill_number,
        items: num(row.items),
        spend: money(row.stake),
        winnings: money(row.payout),
      })),
    };
  },
});

const numberDemand = define({
  name: "number_demand",
  description:
    "เลขที่ลูกค้าซื้อมากที่สุด ใช้ตอบ เลขไหนขายดี เลขฮิต เลขมาแรง เป็นข้อมูลความต้องการซื้อ ไม่ใช่การทำนายผล",
  schema: z.object({
    scope: z.enum(["current_draw", "all_draws"]).default("all_draws"),
    limit: limitSchema,
  }),
  async run(actor, params) {
    const currentDraw =
      params.scope === "current_draw"
        ? await prisma.draw.findFirst({
            where: { organizationId: actor.organizationId },
            orderBy: [{ cutoffAt: "desc" }, { id: "desc" }],
            select: { id: true, name: true },
          })
        : null;

    if (params.scope === "current_draw" && !currentDraw) {
      return { coverage: "ยังไม่มีรอบในระบบ", rows: [] };
    }

    const drawFilter = currentDraw
      ? Prisma.sql`AND b."drawId" = ${currentDraw.id}`
      : Prisma.empty;

    const rows = await prisma.$queryRaw<
      { number: string; prize_type: string; item_count: unknown; stake: unknown }[]
    >`
      SELECT bi."number" AS number,
             pt."name" AS prize_type,
             COUNT(*) AS item_count,
             SUM(bi."stake") AS stake
      FROM ${table("bill_items")} bi
      JOIN ${table("bills")} b ON b."id" = bi."billId"
      JOIN ${table("prize_types")} pt ON pt."id" = bi."prizeTypeId"
      WHERE bi."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
        ${drawFilter}
      GROUP BY bi."number", pt."name"
      ORDER BY COUNT(*) DESC, SUM(bi."stake") DESC, bi."number" ASC
      LIMIT ${params.limit}
    `;
    return {
      coverage: currentDraw
        ? `เฉพาะรอบ ${sanitizeLabel(currentDraw.name)}`
        : "ทุกรอบจากบิลที่ยืนยันแล้ว",
      rows: rows.map((row, index) => ({
        rank: index + 1,
        number: row.number,
        prizeType: sanitizeLabel(row.prize_type),
        itemCount: num(row.item_count),
        stake: money(row.stake),
      })),
    };
  },
});

const prizeTypeMix = define({
  name: "prize_type_mix",
  description:
    "สัดส่วนยอดขายแยกตามประเภทรางวัล ใช้ตอบ ลูกค้าชอบเล่นอะไร ประเภทไหนขายดี product mix",
  schema: z.object({ limit: limitSchema }),
  async run(actor, params) {
    const rows = await prisma.$queryRaw<
      { prize_type: string; item_count: unknown; stake: unknown; share: unknown }[]
    >`
      SELECT pt."name" AS prize_type,
             COUNT(*) AS item_count,
             SUM(bi."stake") AS stake,
             ROUND(
               100.0 * SUM(bi."stake") / NULLIF(SUM(SUM(bi."stake")) OVER (), 0),
               2
             ) AS share
      FROM ${table("bill_items")} bi
      JOIN ${table("bills")} b ON b."id" = bi."billId"
      JOIN ${table("prize_types")} pt ON pt."id" = bi."prizeTypeId"
      WHERE bi."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
      GROUP BY pt."name"
      ORDER BY SUM(bi."stake") DESC
      LIMIT ${params.limit}
    `;
    return {
      coverage: "ทุกรอบจากบิลที่ยืนยันแล้ว sharePercent คือสัดส่วนยอดเดิมพันของทั้งระบบ",
      rows: rows.map((row, index) => ({
        rank: index + 1,
        prizeType: sanitizeLabel(row.prize_type),
        itemCount: num(row.item_count),
        stake: money(row.stake),
        sharePercent: row.share === null ? "0.00" : money(row.share),
      })),
    };
  },
});

const agentPerformance = define({
  name: "agent_performance",
  description: "ผลงานตัวแทน ใช้ตอบ Agent คนไหนขายดี ยอดตัวแทน ช่องทางไหนทำเงิน",
  schema: z.object({ limit: limitSchema }),
  async run(actor, params) {
    const rows = await prisma.$queryRaw<
      {
        code: string;
        name: string;
        bills: unknown;
        customers: unknown;
        sales: unknown;
        payout: unknown;
      }[]
    >`
      SELECT a."code" AS code,
             a."name" AS name,
             COUNT(b."id") AS bills,
             COUNT(DISTINCT b."title") AS customers,
             COALESCE(SUM(b."totalStake"), 0) AS sales,
             COALESCE(SUM(b."totalPayout"), 0) AS payout
      FROM ${table("agents")} a
      LEFT JOIN ${table("bills")} b
        ON b."agentId" = a."id"
       AND b."status" IN (${COUNTED})
      WHERE a."organizationId" = ${actor.organizationId}
      GROUP BY a."id", a."code", a."name"
      ORDER BY COALESCE(SUM(b."totalStake"), 0) DESC, a."code" ASC
      LIMIT ${params.limit}
    `;
    return {
      coverage: "ตัวแทนทุกรายในองค์กร รวมรายที่ยังไม่มียอดขาย",
      rows: rows.map((row, index) => ({
        rank: index + 1,
        agentCode: row.code,
        agentName: sanitizeLabel(row.name),
        bills: num(row.bills),
        customers: num(row.customers),
        sales: money(row.sales),
        prizeExpense: money(row.payout),
      })),
    };
  },
});

const salesByMonth = define({
  name: "sales_by_month",
  description:
    "ยอดขายรายเดือน ใช้ตอบคำถามที่อ้างถึงเดือน เช่น เดือนนี้ขายได้เท่าไร แล้วเดือนก่อนล่ะ เทียบรายเดือน",
  schema: z.object({ limit: limitSchema }),
  async run(actor, params) {
    const rows = await prisma.$queryRaw<
      { period: string; draws: unknown; bills: unknown; sales: unknown; payout: unknown }[]
    >`
      SELECT TO_CHAR(d."cutoffAt", 'YYYY-MM') AS period,
             COUNT(DISTINCT d."id") AS draws,
             COUNT(b."id") AS bills,
             COALESCE(SUM(b."totalStake"), 0) AS sales,
             COALESCE(SUM(b."totalPayout"), 0) AS payout
      FROM ${table("draws")} d
      LEFT JOIN ${table("bills")} b
        ON b."drawId" = d."id"
       AND b."status" IN (${COUNTED})
      WHERE d."organizationId" = ${actor.organizationId}
      GROUP BY TO_CHAR(d."cutoffAt", 'YYYY-MM')
      ORDER BY period DESC
      LIMIT ${params.limit}
    `;
    return {
      coverage: "จัดกลุ่มตามเดือนของเวลาปิดรับ เรียงจากเดือนล่าสุด",
      rows: rows.map((row) => ({
        month: row.period,
        draws: num(row.draws),
        bills: num(row.bills),
        sales: money(row.sales),
        prizeExpense: money(row.payout),
      })),
    };
  },
});

const churnedCustomers = define({
  name: "churned_customers",
  description:
    "ลูกค้าที่เคยซื้อแต่หายไป ใช้ตอบ ลูกค้าคนไหนไม่กลับมาซื้อ ใครหายไป ลูกค้าเลิกเล่น",
  schema: z.object({
    windowDraws: z.coerce.number().int().min(1).max(12).default(3),
    limit: limitSchema,
  }),
  async run(actor, params) {
    const recent = await prisma.draw.findMany({
      where: { organizationId: actor.organizationId },
      orderBy: [{ cutoffAt: "desc" }, { id: "desc" }],
      take: params.windowDraws,
      select: { id: true },
    });
    if (recent.length === 0) return { coverage: "ยังไม่มีรอบในระบบ", rows: [] };

    const recentIds = recent.map((draw) => draw.id);
    const rows = await prisma.$queryRaw<
      { customer_reference: string; bills: unknown; spend: unknown; last_draw: string; last_cutoff: Date }[]
    >`
      SELECT b."title" AS customer_reference,
             COUNT(*) AS bills,
             SUM(b."totalStake") AS spend,
             (ARRAY_AGG(d."name" ORDER BY d."cutoffAt" DESC))[1] AS last_draw,
             MAX(d."cutoffAt") AS last_cutoff
      FROM ${table("bills")} b
      JOIN ${table("draws")} d ON d."id" = b."drawId"
      WHERE b."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
      GROUP BY b."title"
      HAVING COUNT(*) FILTER (WHERE b."drawId" IN (${Prisma.join(recentIds)})) = 0
      ORDER BY SUM(b."totalStake") DESC, b."title" ASC
      LIMIT ${params.limit}
    `;
    return {
      coverage: `ลูกค้าที่ไม่มีบิลเลยใน ${recent.length} รอบล่าสุด เรียงจากยอดซื้อเดิมมากที่สุด`,
      rows: rows.map((row, index) => ({
        rank: index + 1,
        customerReference: sanitizeLabel(row.customer_reference),
        billsBefore: num(row.bills),
        spendBefore: money(row.spend),
        lastDraw: sanitizeLabel(row.last_draw),
        lastSeenAt: row.last_cutoff.toISOString(),
      })),
    };
  },
});

const riskByNumber = define({
  name: "risk_by_number",
  description:
    "ภาระผูกพันของรอบที่ยังไม่ปิดบัญชี ใช้ตอบ ถ้าเลขนี้ออกต้องจ่ายเท่าไร เลขไหนเสี่ยงสุด เจ็บหนักสุด",
  schema: z.object({ limit: limitSchema }),
  async run(actor, params) {
    const draw = await prisma.draw.findFirst({
      where: {
        organizationId: actor.organizationId,
        status: { notIn: ["CLOSED"] },
        bills: { some: { status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } } },
      },
      orderBy: [{ cutoffAt: "desc" }, { id: "desc" }],
      select: { id: true, name: true },
    });
    if (!draw) {
      return {
        coverage: "ไม่มีรอบที่ยังไม่ปิดบัญชีและมีบิลที่ยืนยันแล้ว จึงไม่มีภาระผูกพันค้างอยู่",
        rows: [],
      };
    }
    const rows = await prisma.$queryRaw<
      { number: string; prize_type: string; item_count: unknown; stake: unknown; payout: unknown }[]
    >`
      SELECT bi."number" AS number,
             pt."name" AS prize_type,
             COUNT(*) AS item_count,
             SUM(bi."stake") AS stake,
             SUM(bi."stake" * bi."payoutRateSnapshot") AS payout
      FROM ${table("bill_items")} bi
      JOIN ${table("bills")} b ON b."id" = bi."billId"
      JOIN ${table("prize_types")} pt ON pt."id" = bi."prizeTypeId"
      WHERE bi."organizationId" = ${actor.organizationId}
        AND b."drawId" = ${draw.id}
        AND b."status" IN (${COUNTED})
      GROUP BY bi."number", pt."name"
      ORDER BY SUM(bi."stake" * bi."payoutRateSnapshot") DESC
      LIMIT ${params.limit}
    `;
    return {
      coverage: `ภาระผูกพันของรอบ ${sanitizeLabel(draw.name)} คำนวณจากอัตราจ่ายที่ล็อกไว้ตอนยืนยันบิล`,
      rows: rows.map((row, index) => ({
        rank: index + 1,
        number: row.number,
        prizeType: sanitizeLabel(row.prize_type),
        itemCount: num(row.item_count),
        stake: money(row.stake),
        payoutIfWins: money(row.payout),
      })),
    };
  },
});

const customerNumberRepeat = define({
  name: "customer_number_repeat",
  description:
    "ลูกค้าที่ซื้อเลขเดียวกันซ้ำหลายรายการ ใช้ตอบ ใครซื้อเลขเดิมซ้ำ ลูกค้าคนไหนตอกเลขเดียวกันหลายไม้ ซื้อเลขซ้ำกี่รายการ ยอดรวมของเลขนั้นเท่าไร",
  schema: z.object({
    /** นับว่าซ้ำเมื่อมีตั้งแต่กี่รายการขึ้นไปของเลขเดียวกัน */
    minItems: z.coerce.number().int().min(2).max(50).default(2),
    limit: limitSchema,
  }),
  async run(actor, params) {
    /*
     * จัดกลุ่มด้วยลูกค้ากับเลข ไม่รวมประเภทรางวัลเข้าไปในคีย์
     *
     * เพราะกฎตรวจบิลห้ามรายการซ้ำของเลขเดียวกันในรางวัลเดียวกันภายในบิลใบเดียว
     * การซื้อเลขเดิมซ้ำจึงเกิดได้สองทาง: คนละบิล หรือเลขเดียวกันคนละประเภทรางวัล
     * ถ้าแยกตามประเภทรางวัลด้วย จะมองไม่เห็นกรณีหลังซึ่งเป็นพฤติกรรมที่ผู้ถามสนใจ
     */
    const rows = await prisma.$queryRaw<
      {
        customer_reference: string;
        number: string;
        item_count: unknown;
        stake: unknown;
        bills: unknown;
        draws: unknown;
        prize_types: unknown;
      }[]
    >`
      SELECT b."title" AS customer_reference,
             bi."number" AS number,
             COUNT(*) AS item_count,
             SUM(bi."stake") AS stake,
             COUNT(DISTINCT b."id") AS bills,
             COUNT(DISTINCT b."drawId") AS draws,
             COUNT(DISTINCT bi."prizeTypeId") AS prize_types
      FROM ${table("bill_items")} bi
      JOIN ${table("bills")} b ON b."id" = bi."billId"
      WHERE bi."organizationId" = ${actor.organizationId}
        AND b."status" IN (${COUNTED})
      GROUP BY b."title", bi."number"
      HAVING COUNT(*) >= ${params.minItems}
      ORDER BY COUNT(*) DESC, SUM(bi."stake") DESC, b."title" ASC
      LIMIT ${params.limit}
    `;
    return {
      coverage: `ลูกค้าที่ซื้อเลขเดียวกันตั้งแต่ ${params.minItems} รายการขึ้นไป นับข้ามทุกบิลและทุกรอบจากบิลที่ยืนยันแล้ว`,
      rows: rows.map((row, index) => ({
        rank: index + 1,
        customerReference: sanitizeLabel(row.customer_reference),
        number: row.number,
        repeatedItems: num(row.item_count),
        totalStakeOnNumber: money(row.stake),
        billsInvolved: num(row.bills),
        drawsInvolved: num(row.draws),
        prizeTypesInvolved: num(row.prize_types),
      })),
    };
  },
});

export const QUERY_TOOLS: ToolDefinition[] = [
  drawProfitRanking,
  customerRanking,
  customerDetail,
  numberDemand,
  prizeTypeMix,
  agentPerformance,
  salesByMonth,
  churnedCustomers,
  riskByNumber,
  customerNumberRepeat,
];

const TOOLS_BY_NAME = new Map(QUERY_TOOLS.map((tool) => [tool.name, tool]));

/** รายการเครื่องมือที่ส่งให้โมเดลใช้ตัดสินใจ */
export function toolCatalog(): { name: string; description: string }[] {
  return QUERY_TOOLS.map((tool) => ({ name: tool.name, description: tool.description }));
}

export type QueryToolError = { tool: string; error: string };

/**
 * เรียกคิวรีตามที่โมเดลเลือก
 *
 * ชื่อเครื่องมือที่ไม่รู้จักและพารามิเตอร์ที่ผิดรูปแบบถูกปฏิเสธที่นี่
 * ไม่มีทางที่ค่าจากโมเดลจะไปถึง SQL โดยไม่ผ่าน zod ก่อน
 */
export async function runQueryTool(
  actor: Actor,
  name: string,
  rawParams: unknown,
): Promise<QueryResult | QueryToolError> {
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) return { tool: name, error: "ไม่รู้จักเครื่องมือนี้" };

  const parsed = tool.schema.safeParse(rawParams ?? {});
  if (!parsed.success) {
    return { tool: name, error: `พารามิเตอร์ไม่ถูกต้อง: ${parsed.error.issues[0]?.message ?? ""}` };
  }

  const outcome = await tool.run(actor, parsed.data as never);
  return {
    tool: name,
    params: parsed.data as Record<string, unknown>,
    rowCount: outcome.rows.length,
    coverage: outcome.coverage,
    rows: outcome.rows,
  };
}

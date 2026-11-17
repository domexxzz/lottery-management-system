import { Prisma, type DrawStatus, type LotteryType } from "@prisma/client";
import { databaseSchema, prisma } from "@/lib/db";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { resolveRange, type AccountingQuery, type ResolvedRange } from "./accounting-period";

/**
 * สรุปบัญชีรายงวด สำหรับ Owner/Admin ทำบัญชี
 *
 * แต่ละงวดบอก: ยอดขาย · ลูกค้าถูกรางวัล · จ่ายรางวัล · ค่าคอม (แยกราย Agent)
 * · ยอดสุทธิ = ยอดขาย − ค่าคอม · กำไร/ขาดทุน = ยอดสุทธิ − จ่ายรางวัล
 *
 * - รวมยอดในฐานข้อมูลครั้งเดียว (งวด × Agent) ไม่ดึงบิลทั้งหมดมานับ
 * - ค่าคอมงวดที่คำนวณแล้วใช้ยอดจริงจาก Settlement งวดที่ยังไม่คำนวณประมาณจาก % ของ Agent
 *   (ระบบคิดค่าคอมจากยอดขาย จึงรู้ได้ก่อนออกผล)
 * - จ่ายรางวัลและกำไร/ขาดทุนนับเฉพาะงวดที่คำนวณผลแล้ว งวดที่ยังไม่ออกผลขึ้นว่ารอผล
 */

const SETTLED: readonly DrawStatus[] = ["SETTLED", "CLOSED"];

function table(name: "bills" | "draws") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

export type AccountingAgentLine = {
  agentId: string;
  code: string;
  name: string;
  commissionRate: number;
  bills: number;
  winners: number;
  gross: number;
  commission: number;
  /** ค่าคอมประมาณจาก % (งวดยังไม่คำนวณ) */
  estimated: boolean;
  net: number;
  payout: number;
  /** null = งวดยังไม่คำนวณผล */
  profit: number | null;
};

export type AccountingDrawRow = {
  drawId: string;
  name: string;
  lotteryType: LotteryType;
  drawDate: Date | null;
  cutoffAt: Date;
  status: DrawStatus;
  settled: boolean;
  bills: number;
  winners: number;
  gross: number;
  commission: number;
  estimated: boolean;
  net: number;
  payout: number;
  profit: number | null;
  agents: AccountingAgentLine[];
};

export type AccountingAgentSummary = {
  agentId: string;
  code: string;
  name: string;
  commissionRate: number;
  draws: number;
  bills: number;
  winners: number;
  gross: number;
  commission: number;
  net: number;
  /** นับเฉพาะงวดที่คำนวณแล้ว */
  payout: number;
  profit: number;
  pendingDraws: number;
};

export type AccountingTotals = {
  draws: number;
  settledDraws: number;
  bills: number;
  winners: number;
  gross: number;
  commission: number;
  net: number;
  payout: number;
  /** กำไร/ขาดทุนของงวดที่คำนวณแล้ว */
  profit: number;
};

export type AccountingReport = {
  range: ResolvedRange;
  draws: AccountingDrawRow[];
  agents: AccountingAgentSummary[];
  totals: AccountingTotals;
};

const money = (value: Prisma.Decimal | string | number | null) => Number(value ?? 0);
/** ปัดเป็นสตางค์ กันทศนิยมลอยจากการบวกเลขทศนิยม */
const round2 = (value: number) => Math.round(value * 100) / 100;

export async function loadAccountingReport(actor: Actor, query: AccountingQuery, now = new Date()): Promise<AccountingReport> {
  requirePermission(actor, "report.viewAllAgents");
  const range = resolveRange(query, now);

  const drawFilter = query.period === "draw"
    ? (query.drawId ? Prisma.sql`AND b."drawId" = ${query.drawId}` : Prisma.sql`AND FALSE`)
    : Prisma.sql`AND COALESCE(d."drawDate", (d."cutoffAt" + INTERVAL '7 hours')::date) BETWEEN ${range.from}::date AND ${range.to}::date`;

  const rows = await prisma.$queryRaw<{
    drawId: string; agentId: string; bills: number; winners: number; gross: Prisma.Decimal; payout: Prisma.Decimal;
  }[]>(Prisma.sql`
    SELECT b."drawId", b."agentId",
           COUNT(*)::int AS bills,
           COUNT(DISTINCT LOWER(BTRIM(b.title))) FILTER (WHERE b."totalPayout" > 0)::int AS winners,
           COALESCE(SUM(b."totalStake"), 0) AS gross,
           COALESCE(SUM(b."totalPayout"), 0) AS payout
    FROM ${table("bills")} b
    JOIN ${table("draws")} d ON d.id = b."drawId"
    WHERE b."organizationId" = ${actor.organizationId}
      AND b."status" IN ('CONFIRMED', 'LOCKED', 'SETTLED')
      ${drawFilter}
      ${query.lottery ? Prisma.sql`AND d."lotteryType" = ${query.lottery}::"LotteryType"` : Prisma.empty}
      ${query.agentId ? Prisma.sql`AND b."agentId" = ${query.agentId}` : Prisma.empty}
    GROUP BY b."drawId", b."agentId"
  `);

  const drawIds = [...new Set(rows.map((row) => row.drawId))];
  const agentIds = [...new Set(rows.map((row) => row.agentId))];
  const [draws, agents, settlements] = drawIds.length === 0 ? [[], [], []] : await Promise.all([
    prisma.draw.findMany({
      where: { ...orgScope(actor), id: { in: drawIds } },
      select: { id: true, name: true, lotteryType: true, drawDate: true, cutoffAt: true, status: true },
    }),
    prisma.agent.findMany({
      where: { ...orgScope(actor), id: { in: agentIds } },
      select: { id: true, code: true, name: true, commissionRate: true },
    }),
    prisma.settlement.findMany({
      where: { ...orgScope(actor), drawId: { in: drawIds }, agentId: { in: agentIds } },
      select: { drawId: true, agentId: true, commission: true },
    }),
  ]);
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const commissionByKey = new Map(settlements.map((row) => [`${row.drawId}:${row.agentId}`, money(row.commission)]));

  const drawRows: AccountingDrawRow[] = draws.map((draw) => {
    const settled = SETTLED.includes(draw.status);
    const lines: AccountingAgentLine[] = rows
      .filter((row) => row.drawId === draw.id)
      .map((row) => {
        const agent = agentById.get(row.agentId)!;
        const rate = money(agent.commissionRate);
        const gross = money(row.gross);
        const actual = commissionByKey.get(`${draw.id}:${row.agentId}`);
        const commission = actual ?? round2(gross * rate / 100);
        const net = round2(gross - commission);
        const payout = settled ? money(row.payout) : 0;
        return {
          agentId: agent.id,
          code: agent.code,
          name: agent.name,
          commissionRate: rate,
          bills: row.bills,
          winners: settled ? row.winners : 0,
          gross,
          commission,
          estimated: actual === undefined,
          net,
          payout,
          profit: settled ? round2(net - payout) : null,
        };
      })
      .sort((a, b) => b.gross - a.gross || a.code.localeCompare(b.code));
    const sum = (pick: (line: AccountingAgentLine) => number) => round2(lines.reduce((total, line) => total + pick(line), 0));
    return {
      drawId: draw.id,
      name: draw.name,
      lotteryType: draw.lotteryType,
      drawDate: draw.drawDate,
      cutoffAt: draw.cutoffAt,
      status: draw.status,
      settled,
      bills: sum((line) => line.bills),
      winners: sum((line) => line.winners),
      gross: sum((line) => line.gross),
      commission: sum((line) => line.commission),
      estimated: lines.some((line) => line.estimated),
      net: sum((line) => line.net),
      payout: sum((line) => line.payout),
      profit: settled ? sum((line) => line.profit ?? 0) : null,
      agents: lines,
    };
  }).sort((a, b) => a.cutoffAt.getTime() - b.cutoffAt.getTime());

  const byAgent = new Map<string, AccountingAgentSummary>();
  for (const draw of drawRows) {
    for (const line of draw.agents) {
      const current = byAgent.get(line.agentId) ?? {
        agentId: line.agentId, code: line.code, name: line.name, commissionRate: line.commissionRate,
        draws: 0, bills: 0, winners: 0, gross: 0, commission: 0, net: 0, payout: 0, profit: 0, pendingDraws: 0,
      };
      current.draws += 1;
      current.bills += line.bills;
      current.winners += line.winners;
      current.gross = round2(current.gross + line.gross);
      current.commission = round2(current.commission + line.commission);
      current.net = round2(current.net + line.net);
      current.payout = round2(current.payout + line.payout);
      if (line.profit === null) current.pendingDraws += 1;
      else current.profit = round2(current.profit + line.profit);
      byAgent.set(line.agentId, current);
    }
  }

  const sumDraws = (pick: (row: AccountingDrawRow) => number) => round2(drawRows.reduce((total, row) => total + pick(row), 0));
  return {
    range,
    draws: drawRows,
    agents: [...byAgent.values()].sort((a, b) => b.gross - a.gross || a.code.localeCompare(b.code)),
    totals: {
      draws: drawRows.length,
      settledDraws: drawRows.filter((row) => row.settled).length,
      bills: sumDraws((row) => row.bills),
      winners: sumDraws((row) => row.winners),
      gross: sumDraws((row) => row.gross),
      commission: sumDraws((row) => row.commission),
      net: sumDraws((row) => row.net),
      payout: sumDraws((row) => row.payout),
      profit: sumDraws((row) => row.profit ?? 0),
    },
  };
}

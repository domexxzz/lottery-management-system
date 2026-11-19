import { Prisma, type DrawStatus, type LotteryType } from "@prisma/client";
import { databaseSchema, prisma } from "@/lib/db";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { resolveRange, type AccountingQuery, type ResolvedRange } from "./accounting-period";
import { groupReportDraws, type ReportCategory } from "./draw-groups";

/**
 * สรุปบัญชีรายงวด สำหรับ Owner/Admin ทำบัญชี
 *
 * แต่ละงวดบอก: ยอดขาย · ลูกค้าถูกรางวัล · จ่ายรางวัล · ค่าคอม (แยกราย Agent)
 * · หลังหักคอม = ยอดขาย − ค่าคอม (ยอดที่ Agent ต้องส่ง)
 * · กำไร/ขาดทุน = ยอดขาย − จ่ายรางวัล − ค่าคอม นับเฉพาะงวดที่คำนวณแล้ว
 *   ยอดรวมจึงมี settledGross/settledCommission แยกไว้ ให้สมการกำไรลบกันลงตัวเสมอ
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
  drawIds: string[];
  name: string;
  lotteryType: LotteryType;
  category: ReportCategory;
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
  /** ยอดขาย/ค่าคอมของงวดที่คำนวณแล้ว: settledGross − payout − settledCommission = profit */
  settledGross: number;
  settledCommission: number;
};

export type AccountingTotals = {
  draws: number;
  settledDraws: number;
  bills: number;
  winners: number;
  /** ยอดขายทุกงวดในช่วง รวมงวดที่ยังรอผล */
  gross: number;
  /** ค่าคอมทุกงวด งวดที่ยังไม่คำนวณประมาณจาก % */
  commission: number;
  /** ยอดขาย − ค่าคอม ของทุกงวด (ยอดที่ Agent ต้องส่ง) */
  net: number;
  payout: number;
  /** กำไร/ขาดทุนของงวดที่คำนวณแล้ว */
  profit: number;
  /** ฐานเดียวกับกำไร: settledGross − payout − settledCommission = profit */
  settledGross: number;
  settledCommission: number;
  /** ยอดขายของงวดที่ยังรอผล ยังไม่นับเป็นกำไร */
  pendingGross: number;
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
  let range = resolveRange(query, now);

  let drawFilter: Prisma.Sql;
  if (query.drawIds) {
    // เปรียบเทียบรายงวด: ดูเฉพาะงวดที่ระบุ (งวดของ org นี้เท่านั้น ด้วยเงื่อนไข organizationId ด้านล่าง)
    const selected = query.drawIds.length > 0 ? await prisma.draw.findMany({
      where: { ...orgScope(actor), id: { in: query.drawIds } },
      select: { id: true, lotteryType: true, laoFamilyId: true },
    }) : [];
    const families = selected.map((draw) => draw.laoFamilyId).filter((id): id is string => Boolean(id));
    const paired = families.length > 0 ? await prisma.draw.findMany({
      where: { ...orgScope(actor), laoFamilyId: { in: families }, lotteryType: { in: ["LAO", "LAO_SET"] } },
      select: { id: true },
    }) : [];
    const selectedIds = [...new Set([...selected.map((draw) => draw.id), ...paired.map((draw) => draw.id)])];
    drawFilter = selectedIds.length > 0 ? Prisma.sql`AND b."drawId" IN (${Prisma.join(selectedIds)})` : Prisma.sql`AND FALSE`;
    range = { from: "", to: "", label: "งวดที่เลือก" };
  } else if (query.period === "all") {
    drawFilter = Prisma.empty;
  } else if (query.period === "current_draw" || query.period === "previous_draw") {
    const drawIndex = query.period === "current_draw" ? 0 : 1;
    // หาแยกตามหมวดรายงาน: รัฐบาล และลาวรวมลาวชุด (หนึ่ง family = หนึ่งงวด)
    const categories = [
      ...(query.lotteries.includes("THAI_GOVERNMENT") ? [["THAI_GOVERNMENT"] as LotteryType[]] : []),
      ...(query.lotteries.includes("LAO") || query.lotteries.includes("LAO_SET") ? [["LAO", "LAO_SET"] as LotteryType[]] : []),
    ];
    const candidatesByCategory = await Promise.all(categories.map((lotteryTypes) => prisma.draw.findMany({
      where: { ...orgScope(actor), lotteryType: { in: lotteryTypes }, opensAt: { lte: now } },
      orderBy: { cutoffAt: "desc" },
      take: (drawIndex + 1) * lotteryTypes.length,
      select: { id: true, name: true, lotteryType: true, drawDate: true, cutoffAt: true, status: true, laoFamilyId: true },
    })));
    const drawIds = candidatesByCategory.flatMap((draws) => groupReportDraws(draws)[drawIndex]?.memberIds ?? []);
    drawFilter = drawIds.length > 0
      ? Prisma.sql`AND b."drawId" IN (${Prisma.join(drawIds)})`
      : Prisma.sql`AND FALSE`;
    range = { ...range, label: query.period === "current_draw" ? "งวดนี้ (ล่าสุดของแต่ละประเภทหวย)" : "งวดที่แล้ว (ก่อนหน้าของแต่ละประเภทหวย)" };
  } else {
    drawFilter = Prisma.sql`AND COALESCE(d."drawDate", (d."cutoffAt" + INTERVAL '7 hours')::date) BETWEEN ${range.from}::date AND ${range.to}::date`;
  }
  const lotteryFilter = query.lotteries.length === 0
    ? Prisma.sql`AND FALSE`
    // เทียบเป็น text เพื่อให้ raw query ทำงานได้ทั้ง public schema และ schema แยกของ integration test
    : Prisma.sql`AND d."lotteryType"::text IN (${Prisma.join(query.lotteries)})`;

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
      ${lotteryFilter}
      ${query.agentId ? Prisma.sql`AND b."agentId" = ${query.agentId}` : Prisma.empty}
    GROUP BY b."drawId", b."agentId"
  `);

  const drawIds = [...new Set(rows.map((row) => row.drawId))];
  const agentIds = [...new Set(rows.map((row) => row.agentId))];
  const [draws, agents, settlements] = drawIds.length === 0 ? [[], [], []] : await Promise.all([
    prisma.draw.findMany({
      where: { ...orgScope(actor), id: { in: drawIds } },
      select: { id: true, name: true, lotteryType: true, drawDate: true, cutoffAt: true, status: true, laoFamilyId: true },
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
  // จัดกลุ่มครั้งเดียว ป้องกัน O(จำนวนงวด × จำนวนแถว) เมื่อเลือก "ทั้งหมด"
  const rowsByDraw = new Map<string, typeof rows>();
  for (const row of rows) {
    const grouped = rowsByDraw.get(row.drawId) ?? [];
    grouped.push(row);
    rowsByDraw.set(row.drawId, grouped);
  }

  const physicalDrawRows = draws.map((draw) => {
    const settled = SETTLED.includes(draw.status);
    const lines: AccountingAgentLine[] = (rowsByDraw.get(draw.id) ?? [])
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
      drawIds: [draw.id],
      name: draw.name,
      lotteryType: draw.lotteryType,
      category: draw.lotteryType === "THAI_GOVERNMENT" ? "THAI_GOVERNMENT" as const : "LAO_COMBINED" as const,
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
  });

  const physicalById = new Map(physicalDrawRows.map((draw) => [draw.drawId, draw]));
  const drawRows: AccountingDrawRow[] = groupReportDraws(draws).map((logical) => {
    const members = logical.memberIds.map((id) => physicalById.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
    const linesByAgent = new Map<string, AccountingAgentLine>();
    for (const member of members) {
      for (const line of member.agents) {
        const current = linesByAgent.get(line.agentId);
        if (!current) linesByAgent.set(line.agentId, { ...line });
        else linesByAgent.set(line.agentId, {
          ...current,
          bills: current.bills + line.bills,
          winners: current.winners + line.winners,
          gross: round2(current.gross + line.gross),
          commission: round2(current.commission + line.commission),
          estimated: current.estimated || line.estimated,
          net: round2(current.net + line.net),
          payout: round2(current.payout + line.payout),
          profit: current.profit === null || line.profit === null ? null : round2(current.profit + line.profit),
        });
      }
    }
    const lines = [...linesByAgent.values()].sort((a, b) => b.gross - a.gross || a.code.localeCompare(b.code));
    const settled = members.length > 0 && members.every((row) => row.settled);
    const sum = (pick: (line: AccountingAgentLine) => number) => round2(lines.reduce((total, line) => total + pick(line), 0));
    return {
      drawId: logical.id,
      drawIds: logical.memberIds,
      name: logical.name,
      lotteryType: logical.lotteryType,
      category: logical.category,
      drawDate: logical.drawDate,
      cutoffAt: logical.cutoffAt,
      status: logical.status,
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
        settledGross: 0, settledCommission: 0,
      };
      current.draws += 1;
      current.bills += line.bills;
      current.winners += line.winners;
      current.gross = round2(current.gross + line.gross);
      current.commission = round2(current.commission + line.commission);
      current.net = round2(current.net + line.net);
      current.payout = round2(current.payout + line.payout);
      if (line.profit === null) current.pendingDraws += 1;
      else {
        current.profit = round2(current.profit + line.profit);
        current.settledGross = round2(current.settledGross + line.gross);
        current.settledCommission = round2(current.settledCommission + line.commission);
      }
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
      settledGross: sumDraws((row) => (row.settled ? row.gross : 0)),
      settledCommission: sumDraws((row) => (row.settled ? row.commission : 0)),
      pendingGross: sumDraws((row) => (row.settled ? 0 : row.gross)),
    },
  };
}

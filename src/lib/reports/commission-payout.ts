import type { SettlementStatus } from "@prisma/client";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";
import { commissionDrawDateKey, resolveCommissionPeriod } from "./commission-period";

type CommissionPayoutQuery = {
  lottery?: string;
  drawId?: string;
  period?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
};

const number = (value: unknown) => Number(value ?? 0);

/**
 * รายงานเตรียมจ่ายค่าคอมใช้ Settlement เป็นแหล่งจริงเพียงชุดเดียว
 * จึงไม่ผสมยอดประมาณจากบิลที่งวดยังไม่คำนวณ และยอดรวมตรวจสอบย้อนกลับได้
 */
export async function loadCommissionPayoutReport(actor: Actor, query: CommissionPayoutQuery) {
  requirePermission(actor, "report.viewAllAgents");
  const physicalDraws = await prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: { cutoffAt: "desc" },
    select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true, laoFamilyId: true },
  });
  const scope = resolveDashboardDrawScope(physicalDraws, query.lottery, query.drawId);
  const categoryDraws = scope.drawIds
    ? physicalDraws.filter((draw) => scope.drawIds!.includes(draw.id))
    : physicalDraws;
  const period = resolveCommissionPeriod(query);
  const scopedDraws = period.mode === "all"
    ? categoryDraws
    : categoryDraws.filter((draw) => {
        const key = commissionDrawDateKey(draw.drawDate ?? draw.cutoffAt);
        return period.mode === "range"
          ? (!period.from || key >= period.from) && (!period.to || key <= period.to)
          : key.startsWith(period.value!);
      });
  const scopedDrawIds = scopedDraws.map((draw) => draw.id);
  const drawWhere = (scope.drawIds || period.mode !== "all") ? { drawId: { in: scopedDrawIds } } : {};
  const thaiDrawIds = scopedDraws.filter((draw) => draw.lotteryType === "THAI_GOVERNMENT").map((draw) => draw.id);
  const laoDrawIds = scopedDraws.filter((draw) => draw.lotteryType === "LAO" || draw.lotteryType === "LAO_SET").map((draw) => draw.id);
  const baseWhere = { organizationId: actor.organizationId, ...drawWhere };

  const [overall, thai, lao, statuses, promotionDraws] = await Promise.all([
    prisma.settlement.groupBy({
      by: ["agentId"],
      where: baseWhere,
      _count: { _all: true },
      _sum: { gross: true, payout: true, commission: true, net: true },
    }),
    thaiDrawIds.length
      ? prisma.settlement.groupBy({ by: ["agentId"], where: { organizationId: actor.organizationId, drawId: { in: thaiDrawIds } }, _sum: { commission: true } })
      : Promise.resolve([]),
    laoDrawIds.length
      ? prisma.settlement.groupBy({ by: ["agentId"], where: { organizationId: actor.organizationId, drawId: { in: laoDrawIds } }, _sum: { commission: true } })
      : Promise.resolve([]),
    prisma.settlement.groupBy({ by: ["agentId", "status"], where: baseWhere, _count: { _all: true } }),
    /*
     * นับงวดที่ใช้เรตโปรโมชั่น เพื่อให้คนจ่ายเงินรู้ว่าตัวเลขนี้ไม่ได้คิดจากเรตปกติล้วน ๆ
     * ถ้าไม่บอก คนจ่ายจะเห็นแต่เรตปกติข้างยอดเงินแล้วคิดว่าระบบคำนวณผิด
     */
    prisma.settlement.groupBy({ by: ["agentId"], where: { ...baseWhere, commissionPromotionApplied: true }, _count: { _all: true } }),
  ]);

  const promotionByAgent = new Map(promotionDraws.map((row) => [row.agentId, row._count._all]));
  const agentIds = overall.map((row) => row.agentId);
  const agents = agentIds.length
    ? await prisma.agent.findMany({
        where: { ...orgScope(actor), id: { in: agentIds } },
        select: { id: true, code: true, name: true, commissionRate: true, laoCommissionRate: true },
      })
    : [];
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const thaiByAgent = new Map(thai.map((row) => [row.agentId, number(row._sum.commission)]));
  const laoByAgent = new Map(lao.map((row) => [row.agentId, number(row._sum.commission)]));
  const statusesByAgent = new Map<string, { status: SettlementStatus; count: number }[]>();
  for (const row of statuses) {
    const values = statusesByAgent.get(row.agentId) ?? [];
    values.push({ status: row.status, count: row._count._all });
    statusesByAgent.set(row.agentId, values);
  }

  const baseRows = overall.map((row) => {
    const agent = agentById.get(row.agentId);
    const statusCounts = statusesByAgent.get(row.agentId) ?? [];
    const draftCount = statusCounts.find((item) => item.status === "DRAFT")?.count ?? 0;
    const reconciledCount = statusCounts.find((item) => item.status === "RECONCILED")?.count ?? 0;
    const approvedCount = statusCounts.find((item) => item.status === "APPROVED")?.count ?? 0;
    return {
      agentId: row.agentId,
      code: agent?.code ?? "-",
      name: agent?.name ?? "ไม่พบข้อมูล Agent",
      thaiRate: number(agent?.commissionRate),
      laoRate: number(agent?.laoCommissionRate),
      drawCount: row._count._all,
      promotionDrawCount: promotionByAgent.get(row.agentId) ?? 0,
      gross: number(row._sum.gross),
      payout: number(row._sum.payout),
      thaiCommission: thaiByAgent.get(row.agentId) ?? 0,
      laoCommission: laoByAgent.get(row.agentId) ?? 0,
      commission: number(row._sum.commission),
      net: number(row._sum.net),
      draftCount,
      reconciledCount,
      approvedCount,
    };
  });

  const checklistEnabled = period.mode === "month" && scope.category === "ALL" && !scope.selectedDraw;
  const payments = checklistEnabled && period.value && agentIds.length
    ? await prisma.agentCommissionPayment.findMany({
        where: {
          organizationId: actor.organizationId,
          agentId: { in: agentIds },
          periodMonth: new Date(`${period.value}-01T00:00:00.000Z`),
          voidedAt: null,
        },
        select: {
          id: true,
          agentId: true,
          paidAt: true,
          note: true,
          thaiCommissionSnapshot: true,
          laoCommissionSnapshot: true,
          totalCommissionSnapshot: true,
          settlementCountSnapshot: true,
          paidBy: { select: { displayName: true } },
        },
      })
    : [];
  const paymentByAgent = new Map(payments.map((payment) => [payment.agentId, payment]));
  const rows = baseRows.map((row) => {
    const payment = paymentByAgent.get(row.agentId);
    const snapshotTotal = number(payment?.totalCommissionSnapshot);
    return {
      ...row,
      payment: payment ? {
        id: payment.id,
        paidAt: payment.paidAt,
        paidByName: payment.paidBy?.displayName ?? "ผู้ใช้เดิม",
        note: payment.note,
        thaiCommission: number(payment.thaiCommissionSnapshot),
        laoCommission: number(payment.laoCommissionSnapshot),
        snapshotTotal,
        settlementCount: payment.settlementCountSnapshot,
        difference: Math.round((row.commission - snapshotTotal) * 100) / 100,
      } : null,
    };
  }).sort((a, b) => {
    if (checklistEnabled && Boolean(a.payment) !== Boolean(b.payment)) return a.payment ? 1 : -1;
    return b.commission - a.commission || a.code.localeCompare(b.code, "th-TH");
  });

  const rawTotals = rows.reduce((sum, row) => ({
    gross: sum.gross + row.gross,
    payout: sum.payout + row.payout,
    thaiCommission: sum.thaiCommission + row.thaiCommission,
    laoCommission: sum.laoCommission + row.laoCommission,
    commission: sum.commission + row.commission,
    net: sum.net + row.net,
    draws: sum.draws + row.drawCount,
  }), { gross: 0, payout: 0, thaiCommission: 0, laoCommission: 0, commission: 0, net: 0, draws: 0 });
  const totals = {
    ...rawTotals,
    gross: Math.round(rawTotals.gross * 100) / 100,
    payout: Math.round(rawTotals.payout * 100) / 100,
    thaiCommission: Math.round(rawTotals.thaiCommission * 100) / 100,
    laoCommission: Math.round(rawTotals.laoCommission * 100) / 100,
    commission: Math.round(rawTotals.commission * 100) / 100,
    net: Math.round(rawTotals.net * 100) / 100,
  };
  const checklist = checklistEnabled ? {
    paidAgents: rows.filter((row) => row.payment).length,
    pendingAgents: rows.filter((row) => !row.payment).length,
    paidAmount: Math.round(rows.reduce((sum, row) => sum + (row.payment?.snapshotTotal ?? 0), 0) * 100) / 100,
    pendingAmount: Math.round(rows.reduce((sum, row) => sum + (row.payment ? 0 : row.commission), 0) * 100) / 100,
  } : null;

  const scopeLabel = scope.selectedDraw
    ? `${reportCategoryLabel(scope.selectedDraw.category)} · ${dashboardDrawLabel(scope.selectedDraw)}`
    : scope.category === "ALL"
      ? "ทุกประเภท · ทุกงวดที่คำนวณแล้ว"
      : `${reportCategoryLabel(scope.category)} · ทุกงวดที่คำนวณแล้ว`;

  return { rows, totals, checklist, checklistEnabled, scope, scopeLabel: `${scopeLabel} · ${period.label}`, period };
}

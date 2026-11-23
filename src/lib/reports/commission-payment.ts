import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { commissionDrawDateKey, resolveCommissionPeriod } from "./commission-period";

const number = (value: unknown) => Number(value ?? 0);

function monthDate(month: string): Date {
  const period = resolveCommissionPeriod({ period: "month", date: month });
  if (period.mode !== "month" || !period.value) throw new ValidationError("เดือนที่เลือกไม่ถูกต้อง");
  return new Date(`${period.value}-01T00:00:00.000Z`);
}

function auditValue(payment: {
  id: string;
  agentId: string;
  periodMonth: Date;
  thaiCommissionSnapshot: unknown;
  laoCommissionSnapshot: unknown;
  totalCommissionSnapshot: unknown;
  settlementCountSnapshot: number;
  paidAt: Date;
  paidById: string | null;
  voidedAt: Date | null;
  voidedById: string | null;
  note: string | null;
}) {
  return {
    id: payment.id,
    agentId: payment.agentId,
    month: payment.periodMonth.toISOString().slice(0, 7),
    thaiCommission: number(payment.thaiCommissionSnapshot).toFixed(2),
    laoCommission: number(payment.laoCommissionSnapshot).toFixed(2),
    totalCommission: number(payment.totalCommissionSnapshot).toFixed(2),
    settlementCount: payment.settlementCountSnapshot,
    paidAt: payment.paidAt.toISOString(),
    paidById: payment.paidById,
    voidedAt: payment.voidedAt?.toISOString() ?? null,
    voidedById: payment.voidedById,
    note: payment.note,
  };
}

/** ทำเครื่องหมายรายเดือนว่าได้จ่ายค่าคอมแล้ว พร้อม snapshot ยอดจริงในขณะนั้น */
export async function markAgentCommissionPaid(actor: Actor, input: { agentId: string; month: string; note?: string }) {
  requirePermission(actor, "commission.markPaid");
  const periodMonth = monthDate(input.month);
  const note = input.note?.trim().slice(0, 300) || null;

  return prisma.$transaction(async (tx) => {
    const agent = await tx.agent.findFirst({ where: { ...orgScope(actor), id: input.agentId }, select: { id: true, code: true, name: true } });
    if (!agent) throw new NotFoundError("ไม่พบ Agent");

    const draws = await tx.draw.findMany({
      where: orgScope(actor),
      select: { id: true, lotteryType: true, drawDate: true, cutoffAt: true },
    });
    const monthDraws = draws.filter((draw) => commissionDrawDateKey(draw.drawDate ?? draw.cutoffAt).startsWith(input.month));
    const thaiIds = monthDraws.filter((draw) => draw.lotteryType === "THAI_GOVERNMENT").map((draw) => draw.id);
    const laoIds = monthDraws.filter((draw) => draw.lotteryType === "LAO" || draw.lotteryType === "LAO_SET").map((draw) => draw.id);
    const allIds = [...thaiIds, ...laoIds];
    if (allIds.length === 0) throw new ValidationError("เดือนนี้ไม่มีงวดที่ใช้คำนวณค่าคอม");

    const [overall, thai, lao] = await Promise.all([
      tx.settlement.aggregate({
        where: { organizationId: actor.organizationId, agentId: agent.id, drawId: { in: allIds } },
        _count: { _all: true },
        _sum: { commission: true },
      }),
      thaiIds.length
        ? tx.settlement.aggregate({ where: { organizationId: actor.organizationId, agentId: agent.id, drawId: { in: thaiIds } }, _sum: { commission: true } })
        : Promise.resolve({ _sum: { commission: null } }),
      laoIds.length
        ? tx.settlement.aggregate({ where: { organizationId: actor.organizationId, agentId: agent.id, drawId: { in: laoIds } }, _sum: { commission: true } })
        : Promise.resolve({ _sum: { commission: null } }),
    ]);
    const totalCommission = Math.round(number(overall._sum.commission) * 100) / 100;
    if (overall._count._all === 0) throw new ValidationError("Agent คนนี้ยังไม่มี Settlement ที่คำนวณแล้วในเดือนที่เลือก");

    const key = { organizationId_agentId_periodMonth: { organizationId: actor.organizationId, agentId: agent.id, periodMonth } };
    const before = await tx.agentCommissionPayment.findUnique({ where: key });
    const now = new Date();
    const payment = await tx.agentCommissionPayment.upsert({
      where: key,
      create: {
        organizationId: actor.organizationId,
        agentId: agent.id,
        periodMonth,
        thaiCommissionSnapshot: number(thai._sum.commission),
        laoCommissionSnapshot: number(lao._sum.commission),
        totalCommissionSnapshot: totalCommission,
        settlementCountSnapshot: overall._count._all,
        paidAt: now,
        paidById: actor.userId,
        note,
      },
      update: {
        thaiCommissionSnapshot: number(thai._sum.commission),
        laoCommissionSnapshot: number(lao._sum.commission),
        totalCommissionSnapshot: totalCommission,
        settlementCountSnapshot: overall._count._all,
        paidAt: now,
        paidById: actor.userId,
        note,
        voidedAt: null,
        voidedById: null,
      },
    });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: before ? "UPDATE" : "CREATE",
      entityType: "AgentCommissionPayment",
      entityId: payment.id,
      before: before ? auditValue(before) : undefined,
      after: auditValue(payment),
      reason: `ทำเครื่องหมายจ่ายค่าคอม ${input.month} ให้ ${agent.code} · ${agent.name}`,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
    });
    return payment;
  });
}

/** ยกเลิกเครื่องหมายโดยไม่ลบ record เพื่อให้ Audit ย้อนหลังได้ */
export async function unmarkAgentCommissionPaid(actor: Actor, input: { agentId: string; month: string }) {
  requirePermission(actor, "commission.markPaid");
  const periodMonth = monthDate(input.month);
  return prisma.$transaction(async (tx) => {
    const payment = await tx.agentCommissionPayment.findUnique({
      where: { organizationId_agentId_periodMonth: { organizationId: actor.organizationId, agentId: input.agentId, periodMonth } },
    });
    if (!payment || payment.voidedAt) throw new NotFoundError("ไม่พบรายการที่ทำเครื่องหมายว่าจ่ายแล้ว");
    const updated = await tx.agentCommissionPayment.update({
      where: { id: payment.id },
      data: { voidedAt: new Date(), voidedById: actor.userId },
    });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: "UPDATE",
      entityType: "AgentCommissionPayment",
      entityId: payment.id,
      before: auditValue(payment),
      after: auditValue(updated),
      reason: `ยกเลิกเครื่องหมายจ่ายค่าคอม ${input.month}`,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
    });
    return updated;
  });
}

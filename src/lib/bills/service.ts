import { Prisma } from "@prisma/client";
import type { BillStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { billScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { canTransition, cancelNeedsApproval, transitionError } from "./lifecycle";
import { totalStake, validateBill, type DraftItem, type PrizeTypeRule } from "./validation";

const BILL_NUMBER_PAD = 8;

export type ItemInput = {
  prizeTypeId: string;
  number: string;
  stake: string;
};

/** Agent สร้างบิลให้ตัวเองเท่านั้น บทบาทอื่นต้องระบุว่าสร้างแทน Agent รายใด */
function resolveAgentId(actor: Actor, requestedAgentId: string | undefined): string {
  if (actor.role === "AGENT") {
    if (actor.agentId === null) {
      throw new ForbiddenError("บัญชีนี้ยังไม่ได้ผูกกับ Agent");
    }
    if (requestedAgentId !== undefined && requestedAgentId !== actor.agentId) {
      throw new ForbiddenError("สร้างบิลแทน Agent รายอื่นไม่ได้");
    }
    return actor.agentId;
  }

  if (requestedAgentId === undefined) {
    throw new ValidationError("ต้องระบุ Agent ที่เป็นเจ้าของบิล");
  }
  return requestedAgentId;
}

export async function createDraftBill(
  actor: Actor,
  input: { drawId: string; title: string; agentId?: string },
): Promise<{ billId: string }> {
  requirePermission(actor, "bill.create");
  const agentId = resolveAgentId(actor, input.agentId);

  const title = input.title.trim();
  if (title.length === 0) {
    throw new ValidationError("ต้องกรอกชื่อบิลหรือรหัสอ้างอิงลูกค้า");
  }

  // ตรวจว่ารอบและ Agent อยู่ในองค์กรเดียวกับผู้ใช้ ไม่ใช่แค่มีอยู่จริง
  const [draw, agent] = await Promise.all([
    prisma.draw.findFirst({
      where: { id: input.drawId, organizationId: actor.organizationId },
      select: { id: true, status: true, cutoffAt: true },
    }),
    prisma.agent.findFirst({
      where: { id: agentId, organizationId: actor.organizationId },
      select: { id: true, status: true },
    }),
  ]);

  if (!draw) throw new NotFoundError("ไม่พบรอบที่เลือก");
  if (!agent) throw new NotFoundError("ไม่พบ Agent");
  if (agent.status !== "ACTIVE") throw new ConflictError("Agent รายนี้ถูกระงับอยู่");
  if (draw.status !== "OPEN") throw new ConflictError("รอบนี้ปิดรับรายการแล้ว");
  if (Date.now() >= draw.cutoffAt.getTime()) throw new ConflictError("เลยเวลาปิดรับของรอบนี้แล้ว");

  const bill = await prisma.$transaction(async (tx) => {
    const created = await tx.bill.create({
      data: {
        organizationId: actor.organizationId,
        agentId,
        drawId: draw.id,
        title,
        status: "DRAFT",
        createdById: actor.userId,
      },
      select: { id: true, title: true, agentId: true, drawId: true },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CREATE",
      entityType: "Bill",
      entityId: created.id,
      after: created,
    });

    return created;
  });

  return { billId: bill.id };
}

async function loadPrizeRules(
  client: Prisma.TransactionClient | typeof prisma,
  organizationId: string,
): Promise<Map<string, PrizeTypeRule>> {
  const rows = await client.prizeType.findMany({
    where: { organizationId, isActive: true },
    select: {
      id: true,
      code: true,
      name: true,
      digits: true,
      matchRule: true,
      payoutRate: true,
      maxStakePerItem: true,
    },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * แทนที่รายการทั้งหมดของบิลร่าง
 *
 * ใช้วิธีแทนที่ยกชุดแทนการเพิ่มทีละรายการ เพราะกฎวงเงินต่อเลขและวงเงินรวม
 * ต้องตัดสินจากรายการทั้งใบพร้อมกัน ถ้าเพิ่มทีละรายการจะตรวจได้ไม่ครบ
 *
 * payoutRateSnapshot ที่เขียนตอนนี้เป็นค่าชั่วคราวเพื่อให้คอลัมน์ไม่เป็น null
 * ค่าที่ใช้จริงจะถูกเขียนทับตอนยืนยันบิล (ดู confirmBill)
 */
export async function replaceDraftItems(
  actor: Actor,
  billId: string,
  items: readonly ItemInput[],
): Promise<void> {
  requirePermission(actor, "bill.editBeforeCutoff");

  const bill = await prisma.bill.findFirst({
    where: { id: billId, ...billScope(actor) },
    select: { id: true, status: true, organizationId: true },
  });

  if (!bill) throw new NotFoundError("ไม่พบบิล");
  if (bill.status !== "DRAFT") {
    throw new ConflictError("แก้ไขรายการได้เฉพาะบิลที่ยังเป็นร่าง");
  }

  const rules = await loadPrizeRules(prisma, actor.organizationId);
  const parsed = items.map((item) => ({
    prizeTypeId: item.prizeTypeId,
    number: item.number.trim(),
    stake: toDecimal(item.stake),
  }));

  await prisma.$transaction(async (tx) => {
    await tx.billItem.deleteMany({ where: { billId: bill.id } });

    if (parsed.length > 0) {
      await tx.billItem.createMany({
        data: parsed.map((item) => ({
          organizationId: bill.organizationId,
          billId: bill.id,
          prizeTypeId: item.prizeTypeId,
          number: item.number,
          stake: item.stake,
          payoutRateSnapshot: rules.get(item.prizeTypeId)?.payoutRate ?? new Prisma.Decimal(0),
        })),
      });
    }

    await tx.bill.update({
      where: { id: bill.id },
      data: { totalStake: totalStake(parsed) },
    });

    await writeAudit(tx, {
      organizationId: bill.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "UPDATE",
      entityType: "Bill",
      entityId: bill.id,
      after: { itemCount: parsed.length, totalStake: totalStake(parsed).toFixed(2) },
      reason: "แก้ไขรายการในบิลร่าง",
    });
  });
}

function toDecimal(raw: string): Prisma.Decimal {
  try {
    return new Prisma.Decimal(raw);
  } catch {
    throw new ValidationError(`ยอดเดิมพัน "${raw}" ไม่ใช่ตัวเลขที่ถูกต้อง`);
  }
}

/**
 * ยืนยันบิล
 *
 * Transaction boundary ที่ห้ามแยก (เอกสารบทที่ 6):
 * ออกเลขบิล + เขียน payout snapshot + เปลี่ยนสถานะ + AuditEvent
 * ต้องอยู่ในทรานแซกชันเดียวกันทั้งหมด
 */
export async function confirmBill(
  actor: Actor,
  billId: string,
): Promise<{ billNumber: string; totalStake: string }> {
  requirePermission(actor, "bill.confirm");

  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, ...billScope(actor) },
      include: {
        items: { select: { id: true, prizeTypeId: true, number: true, stake: true } },
        draw: { select: { id: true, status: true, cutoffAt: true } },
        agent: { select: { id: true, status: true, creditLimit: true, perNumberLimit: true } },
      },
    });

    if (!bill) throw new NotFoundError("ไม่พบบิล");
    if (!canTransition(bill.status, "CONFIRMED")) {
      throw new ConflictError(transitionError(bill.status, "CONFIRMED"));
    }
    if (bill.agent.status !== "ACTIVE") {
      throw new ConflictError("Agent รายนี้ถูกระงับอยู่");
    }

    const rules = await loadPrizeRules(tx, bill.organizationId);

    // ยอดที่ Agent ใช้ไปแล้วในรอบนี้ นับเฉพาะบิลที่มีผลผูกพัน ไม่รวมร่างและที่ยกเลิก
    const committed = await tx.bill.aggregate({
      where: {
        organizationId: bill.organizationId,
        agentId: bill.agentId,
        drawId: bill.drawId,
        id: { not: bill.id },
        status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] },
      },
      _sum: { totalStake: true },
    });

    const draftItems: DraftItem[] = bill.items.map((item) => ({
      prizeTypeId: item.prizeTypeId,
      number: item.number,
      stake: item.stake,
    }));

    const issues = validateBill({
      items: draftItems,
      rules,
      agent: { creditLimit: bill.agent.creditLimit, perNumberLimit: bill.agent.perNumberLimit },
      draw: { status: bill.draw.status, cutoffAt: bill.draw.cutoffAt },
      existingStakeInDraw: committed._sum.totalStake ?? new Prisma.Decimal(0),
      now: new Date(),
    });

    if (issues.length > 0) {
      throw new ValidationError(issues.map((i) => i.message).join(" · "));
    }

    // ออกเลขบิลแบบ atomic — UPDATE ... RETURNING กันเลขซ้ำเมื่อยืนยันพร้อมกันหลายคน
    const [org] = await tx.$queryRaw<{ billSequence: number }[]>`
      UPDATE organizations
      SET "billSequence" = "billSequence" + 1
      WHERE id = ${bill.organizationId}
      RETURNING "billSequence"
    `;
    if (!org) throw new NotFoundError("ไม่พบองค์กร");
    const billNumber = String(org.billSequence).padStart(BILL_NUMBER_PAD, "0");

    // เขียน payout snapshot ของจริง ณ วินาทีที่ยืนยัน
    for (const item of bill.items) {
      const rate = rules.get(item.prizeTypeId)?.payoutRate;
      if (!rate) throw new ValidationError("ประเภทรางวัลในบิลถูกปิดใช้งานไปแล้ว");
      await tx.billItem.update({
        where: { id: item.id },
        data: { payoutRateSnapshot: rate },
      });
    }

    const total = totalStake(draftItems);
    const updated = await tx.bill.update({
      where: { id: bill.id },
      data: {
        status: "CONFIRMED",
        billNumber,
        totalStake: total,
        confirmedAt: new Date(),
      },
      select: { id: true, billNumber: true, status: true, totalStake: true },
    });

    await writeAudit(tx, {
      organizationId: bill.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CONFIRM",
      entityType: "Bill",
      entityId: bill.id,
      before: { status: "DRAFT", billNumber: null },
      after: { status: updated.status, billNumber: updated.billNumber },
    });

    return { billNumber, totalStake: total.toFixed(2) };
  });
}

export async function cancelBill(
  actor: Actor,
  billId: string,
  reason: string,
): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("ต้องระบุเหตุผลในการยกเลิก");
  }

  await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, ...billScope(actor) },
      select: { id: true, status: true, organizationId: true, cancelRequestedById: true },
    });

    if (!bill) throw new NotFoundError("ไม่พบบิล");
    if (!canTransition(bill.status, "CANCELLED")) {
      throw new ConflictError(transitionError(bill.status, "CANCELLED"));
    }

    if (cancelNeedsApproval(bill.status)) {
      // หลัง Cutoff ต้องเป็นผู้มีอำนาจอนุมัติ และผู้อนุมัติต้องไม่ใช่ผู้เสนอคนเดียวกัน
      requirePermission(actor, "bill.approveChangeAfterCutoff");
      if (bill.cancelRequestedById === actor.userId) {
        throw new ForbiddenError("ผู้เสนอยกเลิกกับผู้อนุมัติต้องไม่ใช่คนเดียวกัน");
      }
    } else {
      requirePermission(actor, "bill.editBeforeCutoff");
    }

    await tx.bill.update({
      where: { id: bill.id },
      data: {
        status: "CANCELLED",
        cancelledById: actor.userId,
        cancelledAt: new Date(),
        cancelReason: trimmed,
      },
    });

    await writeAudit(tx, {
      organizationId: bill.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CANCEL",
      entityType: "Bill",
      entityId: bill.id,
      before: { status: bill.status, cancelRequestedById: bill.cancelRequestedById },
      after: { status: "CANCELLED" },
      reason: trimmed,
    });
  });
}

/**
 * เสนอยกเลิกบิลหลัง Cutoff
 *
 * Admin เสนอได้แต่ยกเลิกเองไม่ได้ ต้องรอ Owner อนุมัติ (เอกสารบทที่ 4)
 * บันทึกผู้เสนอไว้เพื่อให้ตรวจได้ว่าผู้อนุมัติเป็นคนละคน
 */
export async function requestCancelAfterCutoff(
  actor: Actor,
  billId: string,
  reason: string,
): Promise<void> {
  requirePermission(actor, "bill.proposeChangeAfterCutoff");

  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("ต้องระบุเหตุผลในการเสนอยกเลิก");
  }

  await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, ...billScope(actor) },
      select: { id: true, status: true, organizationId: true, cancelRequestedById: true },
    });

    if (!bill) throw new NotFoundError("ไม่พบบิล");
    if (bill.status !== "LOCKED") {
      throw new ConflictError("เสนอยกเลิกได้เฉพาะบิลที่ถูกล็อกหลังปิดรับแล้ว");
    }
    if (bill.cancelRequestedById !== null) {
      throw new ConflictError("บิลนี้มีคำขอยกเลิกค้างอยู่แล้ว");
    }

    await tx.bill.update({
      where: { id: bill.id },
      data: {
        cancelRequestedById: actor.userId,
        cancelRequestedAt: new Date(),
        cancelRequestReason: trimmed,
      },
    });

    await writeAudit(tx, {
      organizationId: bill.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "UPDATE",
      entityType: "Bill",
      entityId: bill.id,
      before: { cancelRequestedById: null },
      after: { cancelRequestedById: actor.userId },
      reason: `เสนอยกเลิกหลังปิดรับ: ${trimmed}`,
    });
  });
}

export async function listBills(actor: Actor, filter: { drawId?: string; status?: BillStatus }) {
  requirePermission(actor, "bill.viewOwn");

  return prisma.bill.findMany({
    where: {
      ...billScope(actor),
      ...(filter.drawId !== undefined && { drawId: filter.drawId }),
      ...(filter.status !== undefined && { status: filter.status }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      billNumber: true,
      title: true,
      status: true,
      totalStake: true,
      createdAt: true,
      agent: { select: { code: true, name: true } },
      draw: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });
}

export async function getBill(actor: Actor, billId: string) {
  requirePermission(actor, "bill.viewOwn");

  const bill = await prisma.bill.findFirst({
    where: { id: billId, ...billScope(actor) },
    include: {
      items: {
        orderBy: { createdAt: "asc" },
        include: { prizeType: { select: { code: true, name: true, digits: true } } },
      },
      agent: { select: { code: true, name: true } },
      draw: { select: { name: true, cutoffAt: true, status: true } },
      createdBy: { select: { displayName: true } },
      cancelledBy: { select: { displayName: true } },
      cancelRequestedBy: { select: { displayName: true } },
    },
  });

  if (!bill) throw new NotFoundError("ไม่พบบิล");
  return bill;
}

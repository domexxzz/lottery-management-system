import { Prisma } from "@prisma/client";
import type { BillStatus, LotteryType } from "@prisma/client";
import type { BetTab } from "./betting";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { billScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { canTransition, cancelNeedsApproval, transitionError } from "./lifecycle";
import {
  dedupeKey,
  totalStake,
  validateBill,
  type DraftItem,
  type NumberRestriction,
  type PrizeTypeRule,
} from "./validation";
import { assertBillEvidenceReady } from "@/lib/evidence/service";

const BILL_NUMBER_PAD = 8;

export type ItemInput = {
  prizeTypeId: string;
  number: string;
  stake: string;
};

/**
 * Agent สร้างบิลให้ตัวเองเท่านั้น ส่วน Owner/Admin เลือกบัญชีผู้รับบิลได้
 * และระบบจะสร้าง Agent ภายในให้อัตโนมัติเมื่อบัญชี Owner/Admin รับบิลครั้งแรก
 */
async function resolveAgentId(
  actor: Actor,
  requestedAgentId: string | undefined,
  representativeUserId: string | undefined,
): Promise<string> {
  if (actor.role === "AGENT") {
    if (actor.agentId === null) {
      throw new ForbiddenError("บัญชีนี้ยังไม่ได้ผูกกับ Agent");
    }
    if (representativeUserId !== undefined && representativeUserId !== actor.userId) {
      throw new ForbiddenError("สร้างบิลแทนผู้ใช้งานรายอื่นไม่ได้");
    }
    if (requestedAgentId !== undefined && requestedAgentId !== actor.agentId) {
      throw new ForbiddenError("สร้างบิลแทน Agent รายอื่นไม่ได้");
    }
    return actor.agentId;
  }

  if (!representativeUserId) {
    throw new ValidationError("ต้องระบุผู้รับบิล");
  }

  const user = await prisma.user.findFirst({
    where: { id: representativeUserId, organizationId: actor.organizationId },
    select: {
      id: true,
      displayName: true,
      role: true,
      status: true,
      agent: { select: { id: true, status: true } },
    },
  });
  if (!user) throw new NotFoundError("ไม่พบผู้รับบิลที่เลือก");
  if (user.status !== "ACTIVE") throw new ConflictError("บัญชีผู้รับบิลถูกระงับอยู่");
  if (actor.role === "ADMIN" && user.role === "OWNER") {
    throw new ForbiddenError("Admin ไม่สามารถสร้างบิลในนาม Owner ได้");
  }
  if (user.agent?.status === "SUSPENDED") throw new ConflictError("Agent ของผู้รับบิลถูกระงับอยู่");
  if (user.agent) return user.agent.id;

  const agent = await prisma.$transaction(async (tx) => {
    const created = await tx.agent.upsert({
      where: { userId: user.id },
      update: { name: user.displayName, status: "ACTIVE" },
      create: {
        organizationId: actor.organizationId,
        userId: user.id,
        code: `SELF-${user.id}`,
        name: user.displayName,
        commissionRate: new Prisma.Decimal(0),
      },
      select: { id: true, code: true, name: true, status: true, userId: true },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CREATE",
      entityType: "Agent",
      entityId: created.id,
      after: { ...created, source: "AUTO_BILL_REPRESENTATIVE" },
      reason: "สร้าง Agent อัตโนมัติเมื่อผู้ใช้งานรับบิลครั้งแรก",
    });

    return created;
  });

  return agent.id;
}

export async function createDraftBill(
  actor: Actor,
  input: { drawId: string; title: string; agentId?: string; representativeUserId?: string },
): Promise<{ billId: string }> {
  requirePermission(actor, "bill.create");

  const title = input.title.trim();
  if (title.length === 0) {
    throw new ValidationError("ต้องกรอกชื่อบิลหรือรหัสอ้างอิงลูกค้า");
  }

  // ตรวจงวดก่อนสร้าง Agent ภายใน เพื่อไม่ให้คำขอที่เลือกงวดผิดทิ้งข้อมูลส่วนเกินไว้
  const draw = await prisma.draw.findFirst({
    where: { id: input.drawId, organizationId: actor.organizationId },
    select: { id: true, status: true, cutoffAt: true },
  });

  if (!draw) throw new NotFoundError("ไม่พบรอบที่เลือก");
  if (draw.status !== "OPEN") throw new ConflictError("รอบนี้ปิดรับรายการแล้ว");
  if (Date.now() >= draw.cutoffAt.getTime()) throw new ConflictError("เลยเวลาปิดรับของรอบนี้แล้ว");

  const agentId = await resolveAgentId(actor, input.agentId, input.representativeUserId);
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, organizationId: actor.organizationId },
    select: { id: true, status: true },
  });
  if (!agent) throw new NotFoundError("ไม่พบ Agent");
  if (agent.status !== "ACTIVE") throw new ConflictError("Agent รายนี้ถูกระงับอยู่");

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
  return prisma.$transaction((tx) => confirmInTx(tx, actor, billId, { requireEvidence: true }));
}

/** เลขเต็ม/เลขอั้นของงวด คีย์ตาม dedupeKey */
export async function loadRestrictions(
  client: Prisma.TransactionClient | typeof prisma,
  drawId: string,
): Promise<Map<string, NumberRestriction>> {
  const rows = await client.restrictedNumber.findMany({
    where: { drawId },
    select: { prizeTypeId: true, number: true, kind: true, payoutRate: true },
  });
  // number ถูกเก็บแบบ normalize แล้วตั้งแต่ตอนบันทึก จึงประกอบคีย์ได้ตรง ๆ
  return new Map(rows.map((row) => [`${row.prizeTypeId}:${row.number}`, { kind: row.kind, payoutRate: row.payoutRate }]));
}

/**
 * ตรวจและยืนยันบิลภายใน transaction ที่ส่งเข้ามา
 *
 * requireEvidence = false ใช้กับหน้าแทงเลขของ Agent ซึ่งยืนยันได้ทันที
 * แล้วแนบหลักฐานภายหลังที่หน้ารายละเอียดโพย
 */
async function confirmInTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  billId: string,
  options: { requireEvidence: boolean },
): Promise<{ billNumber: string; totalStake: string }> {
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

  // ตรวจซ้ำฝั่ง Server ใน transaction เดียวกับการออกเลขบิล
  // เพื่อไม่ให้ข้ามกฎหลักฐานด้วยการเรียก Action โดยตรง
  if (options.requireEvidence) await assertBillEvidenceReady(tx, bill.id);

  const rules = await loadPrizeRules(tx, bill.organizationId);
  const restrictions = await loadRestrictions(tx, bill.drawId);

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
    restrictions,
  });

  if (issues.length > 0) {
    throw new ValidationError(issues.map((i) => i.message).join(" · "));
  }

  // Prisma แปลง atomic increment เป็น UPDATE ... RETURNING ให้เอง และเคารพ schema
  // ของ driver adapter จึงใช้ได้ทั้ง public และ integration_test โดยไม่เสี่ยง query ข้าม schema
  const org = await tx.organization.update({
    where: { id: bill.organizationId },
    data: { billSequence: { increment: 1 } },
    select: { billSequence: true },
  });
  const billNumber = String(org.billSequence).padStart(BILL_NUMBER_PAD, "0");

  // เขียน payout snapshot ของจริง ณ วินาทีที่ยืนยัน เลขอั้นใช้อัตราที่ลดลง
  for (const item of bill.items) {
    const rule = rules.get(item.prizeTypeId);
    if (!rule) throw new ValidationError("ประเภทรางวัลในบิลถูกปิดใช้งานไปแล้ว");
    const restriction = restrictions.get(dedupeKey(item.prizeTypeId, item.number, rule.matchRule));
    const rate = restriction?.kind === "REDUCED_RATE" && restriction.payoutRate !== null
      ? restriction.payoutRate
      : rule.payoutRate;
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
}

/**
 * แทงเลขจากหน้าโพย: สร้างบิล ใส่รายการ และยืนยันในทรานแซกชันเดียว
 *
 * ถ้าข้อใดไม่ผ่าน ทุกอย่าง rollback จึงไม่มีบิลร่างค้างในระบบ
 */
export async function placeBill(
  actor: Actor,
  input: { drawId: string; title: string; items: readonly ItemInput[]; representativeUserId?: string },
): Promise<{ billId: string; billNumber: string }> {
  requirePermission(actor, "bill.create");
  requirePermission(actor, "bill.confirm");

  const title = input.title.trim();
  if (title.length === 0) throw new ValidationError("กรุณากรอกชื่อลูกค้า");
  if (input.items.length === 0) throw new ValidationError("ยังไม่มีรายการแทง");

  const draw = await prisma.draw.findFirst({
    where: { id: input.drawId, organizationId: actor.organizationId },
    select: { id: true, status: true, cutoffAt: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบงวดที่เลือก");
  if (draw.status !== "OPEN" || Date.now() >= draw.cutoffAt.getTime()) {
    throw new ConflictError("หมดเวลาการเดิมพันสำหรับงวดนี้");
  }

  // Agent ส่ง representativeUserId มาไม่ได้ resolveAgentId ปฏิเสธถ้าไม่ใช่ตัวเอง
  const agentId = await resolveAgentId(actor, undefined, actor.role === "AGENT" ? undefined : input.representativeUserId);
  const parsed = input.items.map((item) => ({
    prizeTypeId: item.prizeTypeId,
    number: item.number.trim(),
    stake: toDecimal(item.stake),
  }));

  return prisma.$transaction(async (tx) => {
    const rules = await loadPrizeRules(tx, actor.organizationId);
    const created = await tx.bill.create({
      data: {
        organizationId: actor.organizationId,
        agentId,
        drawId: draw.id,
        title,
        status: "DRAFT",
        createdById: actor.userId,
        totalStake: totalStake(parsed),
      },
      select: { id: true, title: true, agentId: true, drawId: true },
    });

    await tx.billItem.createMany({
      data: parsed.map((item) => ({
        organizationId: actor.organizationId,
        billId: created.id,
        prizeTypeId: item.prizeTypeId,
        number: item.number,
        stake: item.stake,
        payoutRateSnapshot: rules.get(item.prizeTypeId)?.payoutRate ?? new Prisma.Decimal(0),
      })),
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CREATE",
      entityType: "Bill",
      entityId: created.id,
      after: { ...created, itemCount: parsed.length, source: "BET_SLIP" },
    });

    const confirmed = await confirmInTx(tx, actor, created.id, { requireEvidence: false });
    return { billId: created.id, billNumber: confirmed.billNumber };
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
      draw: { select: { name: true, cutoffAt: true, status: true, drawDate: true, lotteryType: true } },
      createdBy: { select: { displayName: true } },
      cancelledBy: { select: { displayName: true } },
      cancelRequestedBy: { select: { displayName: true } },
      attachments: {
        orderBy: { createdAt: "asc" },
        include: {
          uploadedBy: { select: { displayName: true } },
          verifiedBy: { select: { displayName: true } },
          replacedBy: { select: { id: true } },
        },
      },
      payment: {
        select: {
          amount: true,
          paidAt: true,
          paymentMethod: true,
          bankName: true,
          transactionReference: true,
          note: true,
          verificationStatus: true,
        },
      },
    },
  });

  if (!bill) throw new NotFoundError("ไม่พบบิล");
  return bill;
}

// ---------------------------------------------------------------- โพยของ Agent

function betTabWhere(tab: BetTab): Prisma.BillWhereInput {
  switch (tab) {
    case "PENDING":
      return { status: { in: ["CONFIRMED", "LOCKED"] } };
    case "WON":
      return { status: "SETTLED", totalPayout: { gt: 0 } };
    case "LOST":
      return { status: "SETTLED", totalPayout: { lte: 0 } };
    case "CANCELLED":
      return { status: "CANCELLED" };
    default:
      // ร่างเป็นของค้างจากหน้าเดิม ไม่ใช่โพยที่แทงแล้ว
      return { status: { not: "DRAFT" } };
  }
}

export type BetBillFilter = {
  tab: BetTab;
  lotteryType?: LotteryType;
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  drawId?: string;
  /** ใช้ได้เฉพาะผู้ที่เห็นทุก Agent — Agent ถูก billScope บังคับอยู่แล้ว */
  agentId?: string;
};

export const BET_PAGE_SIZE = 10;

function betBaseWhere(actor: Actor, filter: BetBillFilter): Prisma.BillWhereInput {
  const query = filter.query?.trim();
  return {
    ...billScope(actor),
    ...(filter.agentId && actor.role !== "AGENT" && { agentId: filter.agentId }),
    ...(filter.drawId && { drawId: filter.drawId }),
    ...(filter.lotteryType !== undefined && { draw: { lotteryType: filter.lotteryType } }),
    ...(query && {
      OR: [
        { billNumber: { contains: query, mode: "insensitive" } },
        { title: { contains: query, mode: "insensitive" } },
      ],
    }),
    ...((filter.dateFrom || filter.dateTo) && {
      createdAt: {
        ...(filter.dateFrom && { gte: filter.dateFrom }),
        ...(filter.dateTo && { lte: filter.dateTo }),
      },
    }),
  };
}

/**
 * ประวัติรายการแบบแบ่งหน้า พร้อมจำนวนต่อแท็บและยอดรวมของช่วงที่กรอง
 *
 * ดึงแถวเฉพาะหน้าที่แสดง (10 แถว) ส่วนตัวเลขสรุปคำนวณด้วย aggregate ในฐานข้อมูล
 * ไม่ดึงบิลทั้งหมดมานับในหน่วยความจำ
 */
export async function listBetBills(actor: Actor, filter: BetBillFilter & { page?: number; pageSize?: number }) {
  requirePermission(actor, "bill.viewOwn");

  const base = betBaseWhere(actor, filter);
  const pageSize = filter.pageSize ?? BET_PAGE_SIZE;

  const [grouped, won, totals] = await Promise.all([
    prisma.bill.groupBy({ by: ["status"], where: { ...base, status: { not: "DRAFT" } }, _count: { _all: true } }),
    prisma.bill.count({ where: { ...base, ...betTabWhere("WON") } }),
    prisma.bill.aggregate({
      where: { ...base, status: { not: "DRAFT" } },
      _sum: { totalStake: true, totalPayout: true },
    }),
  ]);

  const byStatus = new Map(grouped.map((row) => [row.status, row._count._all]));
  const settled = byStatus.get("SETTLED") ?? 0;
  const counts: Record<BetTab, number> = {
    ALL: grouped.reduce((sum, row) => sum + row._count._all, 0),
    PENDING: (byStatus.get("CONFIRMED") ?? 0) + (byStatus.get("LOCKED") ?? 0),
    WON: won,
    LOST: settled - won,
    CANCELLED: byStatus.get("CANCELLED") ?? 0,
  };

  const total = counts[filter.tab];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(filter.page ?? 1)), pageCount);

  const bills = total === 0 ? [] : await prisma.bill.findMany({
    where: { ...base, ...betTabWhere(filter.tab) },
    // createdAt มี index ร่วมกับ organizationId/agentId จึงแบ่งหน้าได้เร็ว
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      billNumber: true,
      title: true,
      status: true,
      totalStake: true,
      totalPayout: true,
      createdAt: true,
      confirmedAt: true,
      agent: { select: { code: true, name: true } },
      draw: { select: { name: true, drawDate: true, lotteryType: true, status: true } },
      _count: { select: { items: true } },
    },
  });

  return {
    bills,
    counts,
    page,
    pageCount,
    pageSize,
    total,
    totals: {
      stake: totals._sum.totalStake ?? new Prisma.Decimal(0),
      payout: totals._sum.totalPayout ?? new Prisma.Decimal(0),
    },
  };
}

/** ส่งออก CSV ตามตัวกรองเดียวกับหน้าประวัติ จำกัดจำนวนแถวเพื่อไม่ให้ request ค้าง */
export async function exportBetBills(actor: Actor, filter: BetBillFilter, limit = 5000) {
  requirePermission(actor, "bill.viewOwn");
  return prisma.bill.findMany({
    where: { ...betBaseWhere(actor, filter), ...betTabWhere(filter.tab) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: {
      billNumber: true,
      title: true,
      status: true,
      totalStake: true,
      totalPayout: true,
      createdAt: true,
      agent: { select: { code: true, name: true } },
      draw: { select: { name: true, drawDate: true, lotteryType: true } },
      _count: { select: { items: true } },
    },
  });
}

/** ชื่อลูกค้าเดิมของ Agent คนหนึ่ง เรียงจากที่ใช้ล่าสุด จัดกลุ่มในฐานข้อมูลแทนการดึงบิลหลายพันใบ */
export async function recentCustomerNames(actor: Actor, agentId: string, limit = 100): Promise<string[]> {
  requirePermission(actor, "bill.viewOwn");
  const rows = await prisma.bill.groupBy({
    by: ["title"],
    where: { ...billScope(actor), agentId, status: { not: "DRAFT" } },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: limit,
  });
  return rows.map((row) => row.title.trim()).filter(Boolean);
}

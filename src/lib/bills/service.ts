import { Prisma } from "@prisma/client";
import type { BillStatus, LotteryType } from "@prisma/client";
import type { BetTab } from "./betting";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { billScope, requirePermission, type Actor } from "@/lib/auth/context";
import { BillItemsRejectedError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { canTransition, transitionError } from "./lifecycle";
import {
  dedupeKey,
  totalStake,
  validateBill,
  type DraftItem,
  type NumberRestriction,
  type PrizeTypeRule,
} from "./validation";
import { loadCapOverrides, loadNumberUsage, lockDrawNumberCap } from "@/lib/draws/number-cap";
import { assertBillEvidenceReady } from "@/lib/evidence/service";
import { billSequencePeriod, buildInternalBillNumber } from "./numbering";
import { LAO_SET_ACTIVE_CODES } from "@/lib/lao/rules";

export type ItemInput = {
  prizeTypeId: string;
  number: string;
  /** ราคาต่อหนึ่งชุดสำหรับหวยลาวชุด; หวยทั่วไปคือยอดเดิมพันตามปกติ */
  stake: string;
  quantity?: number;
};

const SOFT_DELETE_REASON = "ลบบิลก่อนปิดรับ";

type BillMutationDraw = {
  status: string;
  cutoffAt: Date;
  officialNumber: string | null;
  _count: { results: number; settlements: number };
};

function isBillManager(actor: Actor): boolean {
  return actor.role === "ADMIN" || actor.role === "OWNER";
}

/** Agent ต้องอยู่ก่อน cutoff; Admin/Owner แก้ย้อนหลังได้เฉพาะช่วงปิดรับแต่ยังไม่มีผล */
function assertBillMutationAllowed(actor: Actor, draw: BillMutationDraw): void {
  if (!isBillManager(actor)) {
    assertDrawStillOpen(draw);
    return;
  }
  if (draw.status !== "OPEN" && draw.status !== "LOCKED") {
    throw new ConflictError("แก้ไขหรือลบบิลได้เฉพาะก่อนกรอกผลรางวัล");
  }
  if (draw.officialNumber !== null || draw._count.results > 0 || draw._count.settlements > 0) {
    throw new ConflictError("งวดนี้มีผลรางวัลหรือคำนวณยอดแล้ว จึงแก้ไขหรือลบบิลไม่ได้");
  }
}

function itemSnapshot(item: { id?: string; prizeTypeId: string; number: string; stake: Prisma.Decimal; packagePrice?: Prisma.Decimal | null; quantity?: number; prizeType?: { name: string } }) {
  return {
    ...(item.id !== undefined && { id: item.id }),
    prizeTypeId: item.prizeTypeId,
    prizeTypeName: item.prizeType?.name,
    number: item.number,
    stake: item.stake.toFixed(2),
    packagePrice: item.packagePrice?.toFixed(2) ?? null,
    quantity: item.quantity ?? 1,
  };
}

function parseItems(items: readonly ItemInput[], rules: ReadonlyMap<string, PrizeTypeRule>): DraftItem[] {
  return items.map((item) => {
    const rule = rules.get(item.prizeTypeId);
    const isLaoSet = rule !== undefined && LAO_SET_ACTIVE_CODES.some((code) => code === rule.code);
    const unitStake = toDecimal(item.stake);
    const quantity = isLaoSet ? (item.quantity ?? 1) : 1;
    return {
      prizeTypeId: item.prizeTypeId,
      number: item.number.trim(),
      stake: isLaoSet ? unitStake.mul(quantity) : unitStake,
      packagePrice: isLaoSet ? unitStake : null,
      quantity,
    };
  });
}

function assertDrawStillOpen(draw: { status: string; cutoffAt: Date }): void {
  if (draw.status !== "OPEN" || Date.now() >= draw.cutoffAt.getTime()) {
    throw new ConflictError("แก้ไขหรือลบบิลได้เฉพาะงวดที่ยังเปิดรับ");
  }
}

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
  /** ส่งมาเมื่อรู้งวดแล้ว: รับเฉพาะรางวัลของประเภทหวยของงวดนั้น */
  lotteryType?: LotteryType,
): Promise<Map<string, PrizeTypeRule>> {
  const rows = await client.prizeType.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(lotteryType ? { lotteryType } : {}),
      ...(lotteryType === "LAO_SET" ? { code: { in: [...LAO_SET_ACTIVE_CODES] } } : {}),
    },
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
  const parsed = parseItems(items, rules);

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
          packagePrice: item.packagePrice,
          quantity: item.quantity,
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

/**
 * แก้เลขและยอดเดิมพันของบิลที่ยืนยันแล้วก่อนปิดรับ
 * มีผลทันทีโดยไม่ต้องรออนุมัติ และเก็บภาพก่อน/หลังทั้งชุดไว้ใน Audit
 */
export async function updateBillBeforeCutoff(
  actor: Actor,
  billId: string,
  input: { title: string; items: readonly ItemInput[] },
  reasonOverride?: string,
  allowItemRemoval = false,
): Promise<void> {
  requirePermission(actor, "bill.editBeforeCutoff");
  const title = input.title.trim();
  if (!title) throw new ValidationError("กรุณากรอกชื่อลูกค้า");
  if (input.items.length === 0) throw new ValidationError("บิลต้องมีอย่างน้อยหนึ่งรายการ");

  await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, ...billScope(actor) },
      include: {
        draw: {
          select: {
            status: true,
            cutoffAt: true,
            numberCap: true,
            lotteryType: true,
            officialNumber: true,
            _count: { select: { results: true, settlements: true } },
          },
        },
        agent: { select: { creditLimit: true, perNumberLimit: true } },
        items: {
          orderBy: { createdAt: "asc" },
          include: { prizeType: { select: { name: true } } },
        },
      },
    });
    if (!bill) throw new NotFoundError("ไม่พบบิล");
    const managerOverride = isBillManager(actor);
    if (bill.status !== "CONFIRMED" && bill.status !== "DRAFT" && !(managerOverride && bill.status === "LOCKED")) {
      throw new ConflictError("บิลนี้แก้ไขไม่ได้แล้ว");
    }
    assertBillMutationAllowed(actor, bill.draw);

    // ราคา 30/60/120 คือประเภทย่อยของหวยลาวชุด ไม่ใช่ยอดที่แก้ภายหลังได้
    // ตรวจซ้ำฝั่ง server เพื่อกันการแก้ hidden field หรือยิง Server Action โดยตรง
    if (bill.draw.lotteryType === "LAO_SET") {
      const signature = (prizeTypeId: string, packagePrice: Prisma.Decimal) => `${prizeTypeId}:${packagePrice.toFixed(2)}`;
      const existingCounts = new Map<string, number>();
      for (const item of bill.items) {
        const key = signature(item.prizeTypeId, item.packagePrice ?? item.stake);
        existingCounts.set(key, (existingCounts.get(key) ?? 0) + 1);
      }
      const nextCounts = new Map<string, number>();
      for (const item of input.items) {
        const key = signature(item.prizeTypeId, toDecimal(item.stake));
        nextCounts.set(key, (nextCounts.get(key) ?? 0) + 1);
      }
      const changedPackage = (!allowItemRemoval && input.items.length !== bill.items.length)
        || input.items.length > bill.items.length
        || [...nextCounts].some(([key, count]) => count > (existingCounts.get(key) ?? 0))
        || (!allowItemRemoval && [...existingCounts].some(([key, count]) => count !== (nextCounts.get(key) ?? 0)));
      if (changedPackage) throw new ValidationError("หวยลาวชุดแก้ได้เฉพาะตัวเลข ประเภทชุด 30/60/120 บาทและประเภทตรง/โต๊ดแก้ไม่ได้");
    }

    const rules = await loadPrizeRules(tx, bill.organizationId, bill.draw.lotteryType);
    const restrictions = await loadRestrictions(tx, bill.drawId);
    const numberCap = await loadNumberCapInTx(tx, bill.drawId, bill.draw.numberCap, bill.id, input.items.map((item) => item.prizeTypeId));
    const parsed = parseItems(input.items, rules);
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
    const issues = validateBill({
      items: parsed,
      rules,
      agent: bill.agent,
      draw: bill.draw,
      existingStakeInDraw: committed._sum.totalStake ?? new Prisma.Decimal(0),
      now: new Date(),
      ignoreDrawWindow: managerOverride,
      restrictions,
      numberCap,
    });
    if (issues.length > 0) throw new ValidationError(issues.map((issue) => issue.message).join(" · "));

    const before = {
      title: bill.title,
      totalStake: bill.totalStake.toFixed(2),
      items: bill.items.map(itemSnapshot),
    };
    await tx.billItem.deleteMany({ where: { billId: bill.id } });
    await tx.billItem.createMany({
      data: parsed.map((item) => {
        const rule = rules.get(item.prizeTypeId);
        if (!rule) throw new ValidationError("ไม่พบประเภทรางวัลที่เลือก");
        const restriction = restrictions.get(dedupeKey(item.prizeTypeId, item.number, rule.matchRule));
        return {
          organizationId: bill.organizationId,
          billId: bill.id,
          prizeTypeId: item.prizeTypeId,
          number: item.number,
          stake: item.stake,
          packagePrice: item.packagePrice,
          quantity: item.quantity,
          payoutRateSnapshot: restriction?.kind === "REDUCED_RATE" && restriction.payoutRate !== null
            ? restriction.payoutRate
            : rule.payoutRate,
        };
      }),
    });
    const total = totalStake(parsed);
    await tx.bill.update({ where: { id: bill.id }, data: { title, totalStake: total } });
    const after = {
      title,
      totalStake: total.toFixed(2),
      items: parsed.map(itemSnapshot),
    };
    await writeAudit(tx, {
      organizationId: bill.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "UPDATE",
      entityType: "Bill",
      entityId: bill.id,
      before,
      after,
      reason: reasonOverride ?? (managerOverride && (bill.draw.status !== "OPEN" || Date.now() >= bill.draw.cutoffAt.getTime())
        ? "ผู้ดูแลแก้ไขบิลหลังปิดรับก่อนกรอกผล"
        : "แก้ไขบิลก่อนปิดรับ"),
    });
  });
}

function editableItemInput(item: {
  prizeTypeId: string;
  number: string;
  stake: Prisma.Decimal;
  packagePrice: Prisma.Decimal | null;
  quantity: number;
}): ItemInput {
  return {
    prizeTypeId: item.prizeTypeId,
    number: item.number,
    stake: (item.packagePrice ?? item.stake).toFixed(2),
    quantity: item.quantity,
  };
}

/** แก้รายการเดียวจากการ์ด โดยยังตรวจทั้งบิลและเก็บ Audit แบบเดียวกับหน้าแก้บิล */
export async function updateBillItemBeforeCutoff(
  actor: Actor,
  billId: string,
  itemId: string,
  input: { number: string; stake: string; quantity?: number },
): Promise<void> {
  const bill = await prisma.bill.findFirst({
    where: { id: billId, ...billScope(actor) },
    select: {
      title: true,
      items: { orderBy: { createdAt: "asc" }, select: { id: true, prizeTypeId: true, number: true, stake: true, packagePrice: true, quantity: true } },
    },
  });
  if (!bill) throw new NotFoundError("ไม่พบบิล");
  if (!bill.items.some((item) => item.id === itemId)) throw new NotFoundError("ไม่พบรายการเลขในบิล");
  await updateBillBeforeCutoff(actor, billId, {
    title: bill.title,
    items: bill.items.map((item) => item.id === itemId
      ? { ...editableItemInput(item), number: input.number, stake: input.stake, quantity: input.quantity ?? item.quantity }
      : editableItemInput(item)),
  }, `แก้ไขรายการเลข ${input.number} จากการ์ดบิล`);
}

/** ลบเฉพาะรายการเดียวจากบิล รายการสุดท้ายต้องใช้การลบทั้งบิลเพื่อคงประวัติให้ครบ */
export async function deleteBillItemBeforeCutoff(actor: Actor, billId: string, itemId: string): Promise<void> {
  const bill = await prisma.bill.findFirst({
    where: { id: billId, ...billScope(actor) },
    select: {
      title: true,
      items: { orderBy: { createdAt: "asc" }, select: { id: true, prizeTypeId: true, number: true, stake: true, packagePrice: true, quantity: true } },
    },
  });
  if (!bill) throw new NotFoundError("ไม่พบบิล");
  if (!bill.items.some((item) => item.id === itemId)) throw new NotFoundError("ไม่พบรายการเลขในบิล");
  if (bill.items.length <= 1) throw new ValidationError("รายการสุดท้ายลบแยกไม่ได้ กรุณาใช้เมนูจัดการบิลเพื่อลบทั้งบิล");
  const removed = bill.items.find((item) => item.id === itemId)!;
  await updateBillBeforeCutoff(actor, billId, {
    title: bill.title,
    items: bill.items.filter((item) => item.id !== itemId).map(editableItemInput),
  }, `ลบรายการเลข ${removed.number} ออกจากบิล`, true);
}

/** ลบเชิงระบบ: เก็บบิล รายการเลข และหลักฐานไว้ แต่ตัดออกจากการคำนวณทันที */
export async function softDeleteBillBeforeCutoff(actor: Actor, billId: string): Promise<void> {
  requirePermission(actor, "bill.delete");
  await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, ...billScope(actor) },
      include: {
        draw: {
          select: {
            status: true,
            cutoffAt: true,
            officialNumber: true,
            _count: { select: { results: true, settlements: true } },
          },
        },
        items: { orderBy: { createdAt: "asc" }, include: { prizeType: { select: { name: true } } } },
      },
    });
    if (!bill) throw new NotFoundError("ไม่พบบิล");
    const managerOverride = isBillManager(actor);
    if (bill.status !== "CONFIRMED" && bill.status !== "DRAFT" && !(managerOverride && bill.status === "LOCKED")) {
      throw new ConflictError("บิลนี้ลบไม่ได้แล้ว");
    }
    assertBillMutationAllowed(actor, bill.draw);
    const deleteReason = managerOverride && (bill.draw.status !== "OPEN" || Date.now() >= bill.draw.cutoffAt.getTime())
      ? "ผู้ดูแลลบบิลหลังปิดรับก่อนกรอกผล"
      : SOFT_DELETE_REASON;
    const deletedAt = new Date();
    await tx.bill.update({
      where: { id: bill.id },
      data: {
        status: "CANCELLED",
        cancelledById: actor.userId,
        cancelledAt: deletedAt,
        cancelReason: deleteReason,
      },
    });
    await writeAudit(tx, {
      organizationId: bill.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "DELETE",
      entityType: "Bill",
      entityId: bill.id,
      before: {
        status: bill.status,
        title: bill.title,
        totalStake: bill.totalStake.toFixed(2),
        items: bill.items.map(itemSnapshot),
      },
      after: { status: "CANCELLED", deletedAt: deletedAt.toISOString(), excludedFromCalculation: true },
      reason: deleteReason,
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
): Promise<{ billNumber: string; drawSequence: number; totalStake: string }> {
  requirePermission(actor, "bill.confirm");
  return prisma.$transaction((tx) => confirmInTx(tx, actor, billId, { requireEvidence: true }));
}

/**
 * เพดานรับต่อเลขของงวด พร้อมยอดที่บิลใบอื่นแทงไปแล้ว
 *
 * ล็อกงวดก่อนอ่านยอด บิลที่ยืนยันพร้อมกันจึงไม่รวมกันเกินเพดาน
 */
async function loadNumberCapInTx(
  tx: Prisma.TransactionClient,
  drawId: string,
  cap: Prisma.Decimal | null,
  billId: string,
  prizeTypeIds: readonly string[],
): Promise<{ cap: Prisma.Decimal | null; used: Map<string, Prisma.Decimal>; overrides: Map<string, Prisma.Decimal> }> {
  const types = [...new Set(prizeTypeIds)];
  const overrides = await loadCapOverrides(tx, drawId, types);
  if (cap === null && overrides.size === 0) return { cap, used: new Map(), overrides };
  await lockDrawNumberCap(tx, drawId);
  return { cap, overrides, used: await loadNumberUsage(tx, drawId, { excludeBillId: billId, prizeTypeIds: types }) };
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
  options: {
    requireEvidence: boolean;
    /** บิลหลายประเภทหวย: ส่วนที่ 2 เป็นต้นไปใช้เลขบิลของส่วนแรก ไม่ออกเลขใหม่ */
    shareSequence?: { drawSequence: number; sequencePeriod: string };
  },
): Promise<{ billNumber: string; drawSequence: number; sequencePeriod: string; totalStake: string }> {
  const bill = await tx.bill.findFirst({
    where: { id: billId, ...billScope(actor) },
    include: {
      items: { select: { id: true, prizeTypeId: true, number: true, stake: true, packagePrice: true, quantity: true } },
      draw: { select: { id: true, status: true, cutoffAt: true, drawDate: true, lotteryType: true, numberCap: true } },
      agent: { select: { id: true, code: true, status: true, creditLimit: true, perNumberLimit: true } },
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

  const rules = await loadPrizeRules(tx, bill.organizationId, bill.draw.lotteryType);
  const restrictions = await loadRestrictions(tx, bill.drawId);
  const numberCap = await loadNumberCapInTx(tx, bill.drawId, bill.draw.numberCap, bill.id, bill.items.map((item) => item.prizeTypeId));

  // ยอดที่ Agent ใช้ไปแล้วในรอบนี้ นับเฉพาะบิลที่มีผลผูกพัน ไม่รวมร่างและบิลที่ลบแล้ว
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
    packagePrice: item.packagePrice,
    quantity: item.quantity,
  }));

  const issues = validateBill({
    items: draftItems,
    rules,
    agent: { creditLimit: bill.agent.creditLimit, perNumberLimit: bill.agent.perNumberLimit },
    draw: { status: bill.draw.status, cutoffAt: bill.draw.cutoffAt },
    existingStakeInDraw: committed._sum.totalStake ?? new Prisma.Decimal(0),
    now: new Date(),
    restrictions,
    numberCap,
  });

  if (issues.length > 0) {
    const message = issues.map((i) => i.message).join(" · ");
    // ปัญหารายเลข (เช่นเลขเต็มระหว่างที่ผู้ใช้กรอก) ส่งกลับเป็นประเภท + เลข
    // หน้าสร้างบิลจะไฮไลต์และให้ลบเฉพาะเลขนั้นได้ ไม่ต้องเริ่มบิลใหม่
    const rejected = issues.flatMap((issue) => {
      const item = issue.itemIndex === null ? undefined : draftItems[issue.itemIndex];
      return item ? [{ prizeTypeId: item.prizeTypeId, number: item.number, reason: issue.message }] : [];
    });
    throw rejected.length > 0 ? new BillItemsRejectedError(message, rejected) : new ValidationError(message);
  }

  const confirmedAt = new Date();
  // ตัวนับแยก Agent/เดือนและเพิ่มแบบ atomic ใน transaction เดียวกับการยืนยัน
  // Agent แต่ละคนจึงเริ่มจากบิล 1 เมื่อขึ้นเดือนใหม่ และกดยืนยันพร้อมกันก็ไม่ชนกัน
  // บิลหลายประเภทหวยออกเลขครั้งเดียวที่ส่วนแรก ส่วนที่เหลือใช้เลขเดียวกัน (แยกด้วยงวด)
  const sequencePeriod = options.shareSequence?.sequencePeriod ?? billSequencePeriod(confirmedAt);
  const drawSequence = options.shareSequence?.drawSequence ?? (await tx.agentBillCounter.upsert({
    where: { agentId_period: { agentId: bill.agentId, period: sequencePeriod } },
    create: {
      organizationId: bill.organizationId,
      agentId: bill.agentId,
      period: sequencePeriod,
      lastSequence: 1,
    },
    update: { lastSequence: { increment: 1 } },
    select: { lastSequence: true },
  })).lastSequence;
  const billNumber = buildInternalBillNumber({
    agentCode: bill.agent.code,
    lotteryType: bill.draw.lotteryType,
    issuedAt: confirmedAt,
    drawSequence,
  });

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
      drawSequence,
      sequencePeriod,
      totalStake: total,
      confirmedAt,
    },
    select: { id: true, billNumber: true, drawSequence: true, sequencePeriod: true, status: true, totalStake: true },
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
    after: { status: updated.status, billNumber: updated.billNumber, drawSequence: updated.drawSequence, sequencePeriod: updated.sequencePeriod },
  });

  return { billNumber, drawSequence, sequencePeriod, totalStake: total.toFixed(2) };
}

/**
 * แทงเลขจากหน้าโพย: สร้างบิล ใส่รายการ และยืนยันในทรานแซกชันเดียว
 *
 * ถ้าข้อใดไม่ผ่าน ทุกอย่าง rollback จึงไม่มีบิลร่างค้างในระบบ
 * บิลประเภทเดียว เรียกผ่าน placeSlip ด้วยงวดเดียว
 */
export async function placeBill(
  actor: Actor,
  input: {
    drawId: string;
    title: string;
    items: readonly ItemInput[];
    representativeUserId?: string;
    /** รหัสการกดยืนยันจาก browser คำขอซ้ำด้วยรหัสเดิมได้บิลเดิมคืน */
    submissionKey?: string;
  },
): Promise<{ billId: string; billNumber: string; drawSequence: number; duplicate?: boolean }> {
  const placed = await placeSlip(actor, {
    title: input.title,
    representativeUserId: input.representativeUserId,
    submissionKey: input.submissionKey,
    parts: [{ drawId: input.drawId, items: input.items }],
  });
  const first = placed.bills[0]!;
  return { billId: first.billId, billNumber: first.billNumber, drawSequence: placed.drawSequence, ...(placed.duplicate ? { duplicate: true } : {}) };
}

export type SlipPartInput = { drawId: string; items: readonly ItemInput[] };
export type PlacedSlip = {
  /** id ของบิลใบหลัก (ส่วนแรก) เมื่อบิลมีหลายประเภทหวย null เมื่อมีประเภทเดียว */
  slipId: string | null;
  /** เลขบิลที่ผู้ใช้เห็น ใช้ร่วมกันทุกส่วนของบิล */
  drawSequence: number;
  /** บิลย่อยต่องวด เรียงตามลำดับที่ส่งมา ใบแรกเป็นใบหลัก (เก็บหลักฐาน) */
  bills: { billId: string; drawId: string; billNumber: string }[];
  duplicate?: boolean;
};

/**
 * บิลเดียวหลายประเภทหวย: ผู้ใช้กดยืนยันครั้งเดียว ได้เลขบิลเดียว
 * ระบบเก็บเป็นบิลย่อยต่องวดที่ผูกด้วย slipId และใช้เลขบิลเดียวกัน
 * การตัดสินผล เพดานเลข เลขอั้น และรายงานจึงทำงานต่องวดเหมือนบิลปกติทุกอย่าง
 *
 * ทุกส่วนอยู่ใน transaction เดียว ส่วนใดไม่ผ่าน (เช่นเลขเต็ม) ทั้งบิลไม่ถูกสร้าง
 */
export async function placeSlip(
  actor: Actor,
  input: {
    title: string;
    representativeUserId?: string;
    submissionKey?: string;
    parts: readonly SlipPartInput[];
  },
): Promise<PlacedSlip> {
  requirePermission(actor, "bill.create");
  requirePermission(actor, "bill.confirm");

  // กดยืนยันซ้ำ/เน็ตส่งซ้ำหลังบิลแรกสำเร็จแล้ว: คืนบิลเดิม ไม่ตรวจกฎซ้ำ (เช่นเลขเต็มเพราะบิลแรกเอง)
  const key = input.submissionKey;
  if (key) {
    const existing = await findSubmittedSlip(actor, key);
    if (existing) return existing;
  }

  try {
    return await placeSlipOnce(actor, input);
  } catch (error) {
    // สองคำขอเข้ามาพร้อมกัน: คำขอหลังรอ unique index จนคำขอแรก commit แล้วชน P2002
    if (key && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await findSubmittedSlip(actor, key);
      if (existing) return existing;
    }
    throw error;
  }
}

async function findSubmittedSlip(actor: Actor, submissionKey: string): Promise<PlacedSlip | null> {
  const bills = await prisma.bill.findMany({
    where: { organizationId: actor.organizationId, submissionKey },
    orderBy: { createdAt: "asc" },
    select: { id: true, drawId: true, billNumber: true, drawSequence: true, createdById: true, slipId: true },
  });
  const first = bills[0];
  if (!first) return null;
  // รหัสสุ่มจาก browser ของผู้ใช้เอง ถ้าเป็นของคนอื่นถือว่าผิดปกติ ไม่คืนบิลของคนอื่นให้
  if (bills.some((bill) => bill.createdById !== actor.userId || bill.drawSequence === null)) {
    throw new ConflictError("คำขอนี้ถูกใช้ไปแล้ว กรุณาโหลดหน้าใหม่แล้วลองอีกครั้ง");
  }
  return {
    slipId: bills.length > 1 ? first.id : null,
    drawSequence: first.drawSequence!,
    bills: bills.map((bill) => ({ billId: bill.id, drawId: bill.drawId, billNumber: bill.billNumber ?? "" })),
    duplicate: true,
  };
}

async function placeSlipOnce(
  actor: Actor,
  input: { title: string; representativeUserId?: string; submissionKey?: string; parts: readonly SlipPartInput[] },
): Promise<PlacedSlip> {
  const title = input.title.trim();
  if (title.length === 0) throw new ValidationError("กรุณากรอกชื่อลูกค้า");

  // รวมส่วนของงวดเดียวกันเข้าด้วยกัน และตัดส่วนที่ไม่มีรายการทิ้ง
  const byDraw = new Map<string, ItemInput[]>();
  for (const part of input.parts) byDraw.set(part.drawId, [...(byDraw.get(part.drawId) ?? []), ...part.items]);
  const parts = [...byDraw.entries()].filter(([, items]) => items.length > 0);
  if (parts.length === 0) throw new ValidationError("ยังไม่มีรายการแทง");

  const draws = await prisma.draw.findMany({
    where: { id: { in: parts.map(([drawId]) => drawId) }, organizationId: actor.organizationId },
    select: { id: true, status: true, cutoffAt: true },
  });
  const drawById = new Map(draws.map((draw) => [draw.id, draw]));
  for (const [drawId] of parts) {
    const draw = drawById.get(drawId);
    if (!draw) throw new NotFoundError("ไม่พบงวดที่เลือก");
    if (draw.status !== "OPEN" || Date.now() >= draw.cutoffAt.getTime()) {
      throw new ConflictError("หมดเวลาการเดิมพันสำหรับงวดนี้");
    }
  }

  // Agent ส่ง representativeUserId มาไม่ได้ resolveAgentId ปฏิเสธถ้าไม่ใช่ตัวเอง
  const agentId = await resolveAgentId(actor, undefined, actor.role === "AGENT" ? undefined : input.representativeUserId);

  return prisma.$transaction(async (tx) => {
    const rules = await loadPrizeRules(tx, actor.organizationId);
    const bills: PlacedSlip["bills"] = [];
    let shared: { drawSequence: number; sequencePeriod: string } | undefined;

    for (const [drawId, items] of parts) {
      const parsed = parseItems(items, rules);
      const created = await tx.bill.create({
        data: {
          organizationId: actor.organizationId,
          agentId,
          drawId,
          title,
          status: "DRAFT",
          createdById: actor.userId,
          totalStake: totalStake(parsed),
          submissionKey: input.submissionKey ?? null,
          // ใบหลักเป็น null ส่วนอื่นชี้ไปที่ใบหลัก หลักฐานแนบที่ใบหลักใบเดียว
          slipId: bills[0]?.billId ?? null,
        },
        select: { id: true, title: true, agentId: true, drawId: true, slipId: true },
      });

      await tx.billItem.createMany({
        data: parsed.map((item) => ({
          organizationId: actor.organizationId,
          billId: created.id,
          prizeTypeId: item.prizeTypeId,
          number: item.number,
          stake: item.stake,
          packagePrice: item.packagePrice,
          quantity: item.quantity,
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

      // ส่วนแรกออกเลขบิลใหม่ ส่วนถัดไปใช้เลขเดียวกัน ผู้ใช้จึงเห็นเป็นบิลเดียว
      const confirmed = await confirmInTx(tx, actor, created.id, { requireEvidence: false, shareSequence: shared });
      shared ??= { drawSequence: confirmed.drawSequence, sequencePeriod: confirmed.sequencePeriod };
      bills.push({ billId: created.id, drawId, billNumber: confirmed.billNumber });
    }

    return { slipId: bills.length > 1 ? bills[0]!.billId : null, drawSequence: shared!.drawSequence, bills };
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
      drawSequence: true,
      title: true,
      status: true,
      cancelReason: true,
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
        include: {
          prizeType: { select: { code: true, name: true, digits: true } },
          winningPrizes: {
            orderBy: [{ payout: "desc" }, { prizeKey: "asc" }],
            select: { id: true, prizeKey: true, prizeLabelSnapshot: true, payoutRateSnapshot: true, payout: true, isPaid: true },
          },
        },
      },
      agent: { select: { code: true, name: true } },
      draw: {
        select: {
          name: true,
          cutoffAt: true,
          status: true,
          drawDate: true,
          lotteryType: true,
          officialNumber: true,
          _count: { select: { results: true, settlements: true } },
        },
      },
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
      // หน้า "ทั้งหมด" หมายถึงบิลที่ยังใช้งานอยู่ ส่วนบิลที่ลบแล้วมีแท็บแยก
      // เพื่อไม่ให้จำนวนบิลปัจจุบันดูมากกว่ายอดที่นำไปคำนวณจริง
      return { status: { notIn: ["DRAFT", "CANCELLED"] } };
  }
}

export type BetBillFilter = {
  tab: BetTab;
  lotteryType?: LotteryType;
  lotteryTypes?: LotteryType[];
  query?: string;
  dateFrom?: Date;
  dateTo?: Date;
  drawId?: string;
  /** เงื่อนไขงวดของขอบเขตงวดปัจจุบัน/ย้อนหลัง */
  drawWhere?: Prisma.DrawWhereInput;
  /** ใช้ได้เฉพาะผู้ที่เห็นทุก Agent — Agent ถูก billScope บังคับอยู่แล้ว */
  agentId?: string;
  sort?: "newest" | "oldest" | "stake_desc" | "payout_desc";
};

function betOrderBy(sort: BetBillFilter["sort"]): Prisma.BillOrderByWithRelationInput[] {
  if (sort === "oldest") return [{ createdAt: "asc" }, { id: "asc" }];
  if (sort === "stake_desc") return [{ totalStake: "desc" }, { createdAt: "desc" }, { id: "desc" }];
  if (sort === "payout_desc") return [{ totalPayout: "desc" }, { createdAt: "desc" }, { id: "desc" }];
  return [{ createdAt: "desc" }, { id: "desc" }];
}

export const BET_PAGE_SIZE = 10;

function betBaseWhere(actor: Actor, filter: BetBillFilter): Prisma.BillWhereInput {
  const query = filter.query?.trim();
  return {
    ...billScope(actor),
    ...(filter.agentId && actor.role !== "AGENT" && { agentId: filter.agentId }),
    ...(filter.drawId && { drawId: filter.drawId }),
    ...((filter.lotteryType !== undefined || filter.lotteryTypes !== undefined || filter.drawWhere) && {
      draw: {
        ...filter.drawWhere,
        ...(filter.lotteryType !== undefined && { lotteryType: filter.lotteryType }),
        ...(filter.lotteryTypes !== undefined && { lotteryType: { in: filter.lotteryTypes } }),
      },
    }),
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

  const [grouped, won, totals, sequence] = await Promise.all([
    prisma.bill.groupBy({ by: ["status"], where: { ...base, status: { not: "DRAFT" } }, _count: { _all: true } }),
    prisma.bill.count({ where: { ...base, ...betTabWhere("WON") } }),
    prisma.bill.aggregate({
      // ยอดสรุปต้องไม่รวมบิลร่างและบิลที่ลบแล้ว
      where: { ...base, ...betTabWhere("ALL") },
      _sum: { totalStake: true, totalPayout: true },
    }),
    prisma.bill.aggregate({
      // เลขสูงสุดยังนับบิลที่ลบแล้ว เพื่ออธิบายช่องว่างของ Running Number
      where: { ...base, status: { not: "DRAFT" } },
      _max: { drawSequence: true },
    }),
  ]);

  const byStatus = new Map(grouped.map((row) => [row.status, row._count._all]));
  const settled = byStatus.get("SETTLED") ?? 0;
  const pending = (byStatus.get("CONFIRMED") ?? 0) + (byStatus.get("LOCKED") ?? 0);
  const cancelled = byStatus.get("CANCELLED") ?? 0;
  const counts: Record<BetTab, number> = {
    ALL: pending + settled,
    PENDING: pending,
    WON: won,
    LOST: settled - won,
    CANCELLED: cancelled,
  };

  const total = counts[filter.tab];
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.floor(filter.page ?? 1)), pageCount);

  const bills = total === 0 ? [] : await prisma.bill.findMany({
    where: { ...base, ...betTabWhere(filter.tab) },
    // createdAt มี index ร่วมกับ organizationId/agentId จึงแบ่งหน้าได้เร็ว
    orderBy: betOrderBy(filter.sort),
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: {
      id: true,
      billNumber: true,
      drawSequence: true,
      title: true,
      status: true,
      cancelReason: true,
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
    sequence: {
      highest: sequence._max.drawSequence,
    },
  };
}

/** ส่งออก CSV ตามตัวกรองเดียวกับหน้าประวัติ จำกัดจำนวนแถวเพื่อไม่ให้ request ค้าง */
export async function exportBetBills(actor: Actor, filter: BetBillFilter, limit = 5000) {
  requirePermission(actor, "bill.viewOwn");
  return prisma.bill.findMany({
    where: { ...betBaseWhere(actor, filter), ...betTabWhere(filter.tab) },
    orderBy: betOrderBy(filter.sort),
    take: limit,
    select: {
      billNumber: true,
      drawSequence: true,
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

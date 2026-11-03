import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { validateResultValue } from "./matching";

/**
 * ลงผลรางวัลแบบ Maker-Checker (LOT-10, LOT-11)
 *
 * Maker กรอกผลเป็น Draft · Checker อนุมัติหรือตีกลับ
 * ผลที่ยังไม่ Approved จะไม่ถูกนำไปคำนวณเงิน
 *
 * ระบบบังคับว่า Maker กับ Checker ของผลใบเดียวกันต้องเป็นคนละคน
 * แม้ Owner จะมีสิทธิ์ทั้งสองอย่างก็ทำคนเดียวทั้งกระบวนการไม่ได้
 */

export async function listResults(actor: Actor, drawId: string) {
  requirePermission(actor, "bill.viewOwn");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, name: true, status: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบรอบ");

  const [prizeTypes, results] = await Promise.all([
    prisma.prizeType.findMany({
      where: { ...orgScope(actor), isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, digits: true, matchRule: true },
    }),
    prisma.result.findMany({
      where: { drawId: draw.id, ...orgScope(actor) },
      orderBy: [{ prizeTypeId: "asc" }, { version: "desc" }],
      select: {
        id: true,
        prizeTypeId: true,
        value: true,
        version: true,
        status: true,
        rejectReason: true,
        maker: { select: { id: true, displayName: true } },
        checker: { select: { displayName: true } },
        enteredAt: true,
        checkedAt: true,
      },
    }),
  ]);

  // แสดงเฉพาะ version ล่าสุดของแต่ละประเภทรางวัล
  const latest = new Map<string, (typeof results)[number]>();
  for (const r of results) {
    if (!latest.has(r.prizeTypeId)) latest.set(r.prizeTypeId, r);
  }

  return { draw, prizeTypes, latestByPrizeType: latest };
}

/** Maker กรอกผล — สร้าง version ใหม่เสมอ ไม่ทับของเดิม เพื่อให้ตรวจย้อนหลังได้ */
export async function enterResult(
  actor: Actor,
  input: { drawId: string; prizeTypeId: string; value: string },
): Promise<void> {
  requirePermission(actor, "result.enter");

  const [draw, prizeType] = await Promise.all([
    prisma.draw.findFirst({
      where: { id: input.drawId, ...orgScope(actor) },
      select: { id: true, status: true },
    }),
    prisma.prizeType.findFirst({
      where: { id: input.prizeTypeId, ...orgScope(actor) },
      select: { id: true, digits: true, matchRule: true, isActive: true },
    }),
  ]);

  if (!draw) throw new NotFoundError("ไม่พบรอบ");
  if (!prizeType) throw new NotFoundError("ไม่พบประเภทรางวัล");
  if (!prizeType.isActive) throw new ConflictError("ประเภทรางวัลนี้ถูกปิดใช้งานแล้ว");

  // ลงผลได้เฉพาะรอบที่ปิดรับแล้ว เพื่อไม่ให้ผลรั่วก่อนปิดรับ
  if (draw.status !== "LOCKED" && draw.status !== "RESULT_PENDING") {
    throw new ConflictError("ลงผลได้เฉพาะรอบที่ปิดรับแล้วและยังไม่ปิดบัญชี");
  }

  const value = input.value.trim();
  const problem = validateResultValue({
    value,
    digits: prizeType.digits,
    matchRule: prizeType.matchRule,
  });
  if (problem) throw new ValidationError(problem);

  await prisma.$transaction(async (tx) => {
    const previous = await tx.result.findFirst({
      where: { drawId: draw.id, prizeTypeId: prizeType.id },
      orderBy: { version: "desc" },
      select: { version: true, status: true, value: true },
    });

    if (previous?.status === "APPROVED") {
      throw new ConflictError(
        "ผลของรางวัลนี้ได้รับการอนุมัติแล้ว การแก้ผลหลังอนุมัติต้องกำหนดขั้นตอนเพิ่ม (LOT-36)",
      );
    }

    const created = await tx.result.create({
      data: {
        organizationId: actor.organizationId,
        drawId: draw.id,
        prizeTypeId: prizeType.id,
        value,
        version: (previous?.version ?? 0) + 1,
        status: "DRAFT",
        makerId: actor.userId,
      },
      select: { id: true, value: true, version: true },
    });

    if (draw.status === "LOCKED") {
      await tx.draw.update({ where: { id: draw.id }, data: { status: "RESULT_PENDING" } });
    }

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CREATE",
      entityType: "Result",
      entityId: created.id,
      before: previous ? { value: previous.value, version: previous.version } : undefined,
      after: { value: created.value, version: created.version, status: "DRAFT" },
    });
  });
}

export async function approveResult(actor: Actor, resultId: string): Promise<void> {
  requirePermission(actor, "result.approve");

  await prisma.$transaction(async (tx) => {
    const result = await tx.result.findFirst({
      where: { id: resultId, ...orgScope(actor) },
      select: { id: true, status: true, makerId: true, value: true, version: true },
    });

    if (!result) throw new NotFoundError("ไม่พบผลรางวัล");
    if (result.status !== "DRAFT") throw new ConflictError("ผลนี้ถูกตรวจไปแล้ว");

    // หัวใจของ Maker-Checker — คนกรอกกับคนอนุมัติต้องคนละคน
    if (result.makerId === actor.userId) {
      throw new ForbiddenError("ผู้กรอกผลกับผู้อนุมัติผลต้องไม่ใช่คนเดียวกัน");
    }

    await tx.result.update({
      where: { id: result.id },
      data: { status: "APPROVED", checkerId: actor.userId, checkedAt: new Date() },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "APPROVE",
      entityType: "Result",
      entityId: result.id,
      before: { status: "DRAFT" },
      after: { status: "APPROVED", value: result.value, version: result.version },
    });
  });
}

export async function rejectResult(actor: Actor, resultId: string, reason: string): Promise<void> {
  requirePermission(actor, "result.approve");

  const trimmed = reason.trim();
  if (trimmed === "") throw new ValidationError("ต้องระบุเหตุผลที่ตีกลับ");

  await prisma.$transaction(async (tx) => {
    const result = await tx.result.findFirst({
      where: { id: resultId, ...orgScope(actor) },
      select: { id: true, status: true, makerId: true },
    });

    if (!result) throw new NotFoundError("ไม่พบผลรางวัล");
    if (result.status !== "DRAFT") throw new ConflictError("ผลนี้ถูกตรวจไปแล้ว");
    if (result.makerId === actor.userId) {
      throw new ForbiddenError("ผู้กรอกผลกับผู้ตรวจผลต้องไม่ใช่คนเดียวกัน");
    }

    await tx.result.update({
      where: { id: result.id },
      data: {
        status: "REJECTED",
        checkerId: actor.userId,
        checkedAt: new Date(),
        rejectReason: trimmed,
      },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "REJECT",
      entityType: "Result",
      entityId: result.id,
      before: { status: "DRAFT" },
      after: { status: "REJECTED" },
      reason: trimmed,
    });
  });
}

import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

export type DrawInput = {
  name: string;
  opensAt: string;
  cutoffAt: string;
};

function parseDate(raw: string, label: string): Date {
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new ValidationError(`${label}ไม่ใช่วันเวลาที่ถูกต้อง`);
  }
  return value;
}

export async function listDraws(actor: Actor) {
  requirePermission(actor, "bill.viewOwn");

  return prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: { cutoffAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      opensAt: true,
      cutoffAt: true,
      status: true,
      lockedAt: true,
      _count: { select: { bills: true } },
    },
  });
}

export async function createDraw(actor: Actor, input: DrawInput): Promise<{ drawId: string }> {
  requirePermission(actor, "draw.manage");

  const name = input.name.trim();
  if (name === "") throw new ValidationError("ต้องกรอกชื่อรอบ");

  const opensAt = parseDate(input.opensAt, "เวลาเปิดรับ");
  const cutoffAt = parseDate(input.cutoffAt, "เวลาปิดรับ");

  if (cutoffAt.getTime() <= opensAt.getTime()) {
    throw new ValidationError("เวลาปิดรับต้องหลังเวลาเปิดรับ");
  }

  const duplicate = await prisma.draw.findFirst({
    where: { ...orgScope(actor), name },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError(`ชื่อรอบ "${name}" ถูกใช้ไปแล้ว`);

  const draw = await prisma.$transaction(async (tx) => {
    const created = await tx.draw.create({
      data: { organizationId: actor.organizationId, name, opensAt, cutoffAt, status: "OPEN" },
      select: { id: true, name: true, opensAt: true, cutoffAt: true, status: true },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: "CREATE",
      entityType: "Draw",
      entityId: created.id,
      after: {
        name: created.name,
        opensAt: created.opensAt.toISOString(),
        cutoffAt: created.cutoffAt.toISOString(),
      },
    });

    return created;
  });

  return { drawId: draw.id };
}

export type LockOutcome = {
  drawId: string;
  drawName: string;
  billsLocked: number;
  draftsCancelled: number;
};

/**
 * ปิดรอบและล็อกบิลทั้งรอบ
 *
 * ทำทั้งหมดในทรานแซกชันเดียว: เปลี่ยนสถานะรอบ ล็อกบิลที่ยืนยันแล้ว
 * ยกเลิกบิลร่างที่ค้าง และเขียน audit
 *
 * บิลร่างที่ยังไม่ยืนยันถือว่าตกไป ไม่ใช่ปล่อยค้างเป็น DRAFT ตลอดไป
 * เพราะร่างที่ค้างอยู่หลังปิดรอบจะยืนยันไม่ได้อีกแล้วและทำให้รายงานสับสน
 *
 * actorId เป็น null ได้เมื่อ job อัตโนมัติเป็นผู้เรียก
 */
export async function lockDraw(
  drawId: string,
  options: { actorId: string | null; reason: string },
): Promise<LockOutcome> {
  return prisma.$transaction(async (tx) => {
    const draw = await tx.draw.findUnique({
      where: { id: drawId },
      select: { id: true, name: true, status: true, organizationId: true },
    });

    if (!draw) throw new NotFoundError("ไม่พบรอบ");
    if (draw.status !== "OPEN") {
      throw new ConflictError(`รอบ "${draw.name}" ไม่ได้อยู่ในสถานะเปิดรับ`);
    }

    const now = new Date();

    const locked = await tx.bill.updateMany({
      where: { drawId: draw.id, status: "CONFIRMED" },
      data: { status: "LOCKED" },
    });

    const cancelled = await tx.bill.updateMany({
      where: { drawId: draw.id, status: "DRAFT" },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelReason: "บิลร่างค้างอยู่เมื่อถึงเวลาปิดรับ",
      },
    });

    await tx.draw.update({
      where: { id: draw.id },
      data: { status: "LOCKED", lockedAt: now },
    });

    await writeAudit(tx, {
      organizationId: draw.organizationId,
      actorId: options.actorId,
      action: "LOCK",
      entityType: "Draw",
      entityId: draw.id,
      before: { status: "OPEN" },
      after: {
        status: "LOCKED",
        billsLocked: locked.count,
        draftsCancelled: cancelled.count,
      },
      reason: options.reason,
    });

    return {
      drawId: draw.id,
      drawName: draw.name,
      billsLocked: locked.count,
      draftsCancelled: cancelled.count,
    };
  });
}

/** ปิดรอบด้วยมือ ใช้เมื่อต้องปิดก่อนเวลาหรือเมื่อ job ไม่ทำงาน */
export async function lockDrawManually(actor: Actor, drawId: string): Promise<LockOutcome> {
  requirePermission(actor, "draw.manage");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบรอบ");

  return lockDraw(draw.id, { actorId: actor.userId, reason: "ปิดรอบด้วยมือโดยผู้ดูแล" });
}

/**
 * งานอัตโนมัติ: ปิดทุกรอบที่ถึงเวลา Cutoff แล้ว
 *
 * ไม่รับ Actor เพราะเรียกจาก scheduler ไม่ใช่จากผู้ใช้
 * ทำทีละรอบเพื่อให้รอบที่ล้มเหลวไม่ลากรอบอื่นตกไปด้วย
 */
export async function lockDueDraws(now: Date = new Date()): Promise<{
  locked: LockOutcome[];
  failed: { drawId: string; error: string }[];
}> {
  const due = await prisma.draw.findMany({
    where: { status: "OPEN", cutoffAt: { lte: now } },
    select: { id: true },
  });

  const locked: LockOutcome[] = [];
  const failed: { drawId: string; error: string }[] = [];

  for (const draw of due) {
    try {
      locked.push(
        await lockDraw(draw.id, { actorId: null, reason: "ถึงเวลาปิดรับอัตโนมัติ" }),
      );
    } catch (error) {
      failed.push({
        drawId: draw.id,
        error: error instanceof Error ? error.message : "ไม่ทราบสาเหตุ",
      });
    }
  }

  return { locked, failed };
}

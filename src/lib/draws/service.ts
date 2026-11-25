import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage/provider";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import { nextOfficialDrawDate, officialDrawCutoffAt, officialDrawName, parseBangkokDateTimeLocal } from "./schedule";

export type DrawInput = {
  drawDate: string;
  opensAt: string;
  cutoffAt: string;
};

export async function listDraws(
  actor: Actor,
  take: number | null = 50,
  order: "createdAt" | "opensAt" = "createdAt",
) {
  requirePermission(actor, "bill.viewOwn");

  return prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: order === "opensAt"
      ? [{ opensAt: "desc" }, { createdAt: "desc" }, { id: "desc" }]
      : [{ createdAt: "desc" }, { id: "desc" }],
    ...(take === null ? {} : { take }),
    select: {
      id: true,
      name: true,
      drawDate: true,
      opensAt: true,
      cutoffAt: true,
      createdAt: true,
      status: true,
      lotteryType: true,
      laoFamilyId: true,
      lockedAt: true,
      settlements: { select: { status: true } },
      _count: { select: { bills: true, results: true } },
    },
  });
}

export async function createDraw(actor: Actor, input: DrawInput): Promise<{ drawId: string; duplicate: boolean }> {
  requirePermission(actor, "draw.manage");

  const officialCutoff = officialDrawCutoffAt(input.drawDate);
  const name = officialCutoff ? officialDrawName(input.drawDate) : null;
  if (!officialCutoff || !name) throw new ValidationError("เลือกงวดได้เฉพาะวันที่ 1 หรือ 16 เท่านั้น");

  const opensAt = parseBangkokDateTimeLocal(input.opensAt);
  const cutoffAt = parseBangkokDateTimeLocal(input.cutoffAt);
  if (!opensAt) throw new ValidationError("เวลาเปิดรับไม่ถูกต้อง");
  if (!cutoffAt) throw new ValidationError("เวลาปิดรับไม่ถูกต้อง");

  if (cutoffAt.getTime() <= opensAt.getTime()) {
    throw new ValidationError("เวลาปิดรับต้องอยู่หลังเวลาเปิดรับ");
  }

  const draw = await prisma.$transaction(async (tx) => {
    const duplicateCount = await tx.draw.count({
      where: { ...orgScope(actor), name },
    });
    const created = await tx.draw.create({
      data: {
        organizationId: actor.organizationId,
        name,
        lotteryType: "THAI_GOVERNMENT",
        drawDate: nextOfficialDrawDate(input.drawDate),
        opensAt,
        cutoffAt,
        status: "OPEN",
      },
      select: { id: true, name: true, opensAt: true, cutoffAt: true, status: true },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CREATE",
      entityType: "Draw",
      entityId: created.id,
      after: {
        name: created.name,
        opensAt: created.opensAt.toISOString(),
        cutoffAt: created.cutoffAt.toISOString(),
        duplicate: duplicateCount > 0,
        duplicateSequence: duplicateCount + 1,
      },
    });

    return { ...created, duplicateCount };
  });

  return { drawId: draw.id, duplicate: draw.duplicateCount > 0 };
}

export type LockOutcome = {
  drawId: string;
  drawName: string;
  billsLocked: number;
  draftsCancelled: number;
};

type LockOptions = { actorId: string | null; reason: string; requestId?: string | undefined };

/**
 * ปิดงวดและล็อกบิลทั้งงวด
 *
 * ทำทั้งหมดในทรานแซกชันเดียว: เปลี่ยนสถานะงวด ล็อกบิลที่ยืนยันแล้ว
 * ยกเลิกบิลร่างที่ค้าง และเขียน audit
 *
 * บิลร่างที่ยังไม่ยืนยันถือว่าตกไป ไม่ใช่ปล่อยค้างเป็น DRAFT ตลอดไป
 * เพราะร่างที่ค้างอยู่หลังปิดงวดจะยืนยันไม่ได้อีกแล้วและทำให้รายงานสับสน
 *
 * actorId เป็น null ได้เมื่อ job อัตโนมัติเป็นผู้เรียก
 */
async function lockDrawInTransaction(
  tx: Prisma.TransactionClient,
  drawId: string,
  options: LockOptions,
): Promise<LockOutcome> {
  const draw = await tx.draw.findUnique({
    where: { id: drawId },
    select: { id: true, name: true, status: true, organizationId: true },
  });

  if (!draw) throw new NotFoundError("ไม่พบงวด");
  if (draw.status !== "OPEN") {
    throw new ConflictError(`งวด "${draw.name}" ไม่ได้อยู่ในสถานะเปิดรับ`);
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
    requestId: options.requestId,
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
}

export async function lockDraw(drawId: string, options: LockOptions): Promise<LockOutcome> {
  return prisma.$transaction((tx) => lockDrawInTransaction(tx, drawId, options));
}

/** ปิดงวดที่เลือกและงวดลาวคู่กันใน transaction เดียว */
async function lockDrawFamily(drawId: string, options: LockOptions): Promise<LockOutcome> {
  return prisma.$transaction(async (tx) => {
    const selected = await tx.draw.findUnique({
      where: { id: drawId },
      select: {
        id: true,
        name: true,
        status: true,
        organizationId: true,
        lotteryType: true,
        laoFamilyId: true,
      },
    });
    if (!selected) throw new NotFoundError("ไม่พบงวด");
    if (selected.status !== "OPEN") {
      throw new ConflictError(`งวด "${selected.name}" ไม่ได้อยู่ในสถานะเปิดรับ`);
    }

    const paired = (selected.lotteryType === "LAO" || selected.lotteryType === "LAO_SET")
      && selected.laoFamilyId;
    const members = paired
      ? await tx.draw.findMany({
        where: {
          organizationId: selected.organizationId,
          laoFamilyId: selected.laoFamilyId,
          lotteryType: { in: ["LAO", "LAO_SET"] },
          status: "OPEN",
        },
        orderBy: [{ lotteryType: "asc" }, { createdAt: "asc" }],
        select: { id: true },
      })
      : [{ id: selected.id }];

    const outcomes: LockOutcome[] = [];
    for (const member of members) {
      outcomes.push(await lockDrawInTransaction(tx, member.id, options));
    }
    return {
      drawId: selected.id,
      drawName: outcomes.map((outcome) => outcome.drawName).join(" + "),
      billsLocked: outcomes.reduce((sum, outcome) => sum + outcome.billsLocked, 0),
      draftsCancelled: outcomes.reduce((sum, outcome) => sum + outcome.draftsCancelled, 0),
    };
  });
}

/** ปิดงวดด้วยมือ ใช้เมื่อต้องปิดก่อนเวลาหรือเมื่อ job ไม่ทำงาน */
export async function lockDrawManually(actor: Actor, drawId: string): Promise<LockOutcome> {
  requirePermission(actor, "draw.manage");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบงวด");

  return lockDrawFamily(draw.id, {
    actorId: actor.userId,
    reason: "ปิดงวดด้วยมือโดยผู้ดูแล",
    requestId: actor.requestId,
  });
}

export type ReopenDrawOutcome = {
  drawId: string;
  drawName: string;
  drawsReopened: number;
  billsUnlocked: number;
  cutoffAt: Date;
};

/**
 * เปิดรับงวดที่ปิดรับแล้วอีกครั้ง ก่อนมีการกรอกผลหรือคำนวณยอดเท่านั้น
 * งวดหวยลาว/ลาวชุดในครอบครัวเดียวกันจะเปิดพร้อมกันและใช้ cutoff ใหม่เดียวกัน
 */
export async function reopenDrawManually(
  actor: Actor,
  drawId: string,
  cutoffAtInput: string,
): Promise<ReopenDrawOutcome> {
  requirePermission(actor, "draw.manage");
  const cutoffAt = parseBangkokDateTimeLocal(cutoffAtInput);
  if (!cutoffAt) throw new ValidationError("เวลาปิดรับใหม่ไม่ถูกต้อง");
  if (cutoffAt.getTime() <= Date.now()) throw new ValidationError("เวลาปิดรับใหม่ต้องอยู่หลังเวลาปัจจุบัน");

  return prisma.$transaction(async (tx) => {
    const selected = await tx.draw.findFirst({
      where: { id: drawId, ...orgScope(actor) },
      select: { id: true, laoFamilyId: true, lotteryType: true },
    });
    if (!selected) throw new NotFoundError("ไม่พบงวด");

    const paired = (selected.lotteryType === "LAO" || selected.lotteryType === "LAO_SET")
      && selected.laoFamilyId !== null;
    const members = await tx.draw.findMany({
      where: paired
        ? { organizationId: actor.organizationId, laoFamilyId: selected.laoFamilyId!, lotteryType: { in: ["LAO", "LAO_SET"] } }
        : { id: selected.id, organizationId: actor.organizationId },
      orderBy: [{ lotteryType: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        status: true,
        cutoffAt: true,
        officialNumber: true,
        _count: { select: { results: true, settlements: true } },
      },
    });
    if (members.length === 0) throw new NotFoundError("ไม่พบงวด");

    const blocked = members.find((draw) => (
      draw.status !== "LOCKED"
      || draw.officialNumber !== null
      || draw._count.results > 0
      || draw._count.settlements > 0
    ));
    if (blocked) {
      throw new ConflictError(`งวด "${blocked.name}" เปิดรับอีกครั้งไม่ได้ เพราะมีผลรางวัล/ยอดคำนวณแล้ว หรือไม่ได้อยู่ในสถานะปิดรับ`);
    }

    let billsUnlocked = 0;
    for (const draw of members) {
      const bills = await tx.bill.updateMany({
        where: { drawId: draw.id, status: "LOCKED" },
        data: { status: "CONFIRMED" },
      });
      billsUnlocked += bills.count;
      await tx.draw.update({
        where: { id: draw.id },
        data: { status: "OPEN", cutoffAt, lockedAt: null, closedAt: null },
      });
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: "UPDATE",
        entityType: "Draw",
        entityId: draw.id,
        before: { status: draw.status, cutoffAt: draw.cutoffAt.toISOString() },
        after: { status: "OPEN", cutoffAt: cutoffAt.toISOString(), billsUnlocked: bills.count },
        reason: "ผู้ดูแลเปิดรับงวดอีกครั้งก่อนกรอกผล",
      });
    }

    return {
      drawId: selected.id,
      drawName: members.map((draw) => draw.name).join(" + "),
      drawsReopened: members.length,
      billsUnlocked,
      cutoffAt,
    };
  });
}

export type DeleteDrawOutcome = {
  drawId: string;
  drawName: string;
  billsDeleted: number;
  billItemsDeleted: number;
  attachmentsDeleted: number;
  paymentsDeleted: number;
  resultsDeleted: number;
  settlementsDeleted: number;
};

/**
 * ลบงวดถาวรพร้อมข้อมูลลูกทั้งหมด โดยสงวน Audit Log ไว้ตรวจสอบย้อนหลัง
 *
 * ความสัมพันธ์ Bill/Result/Settlement ไม่ได้ตั้ง onDelete: Cascade เพราะระบบปกติ
 * ต้องห้ามลบโดยอุบัติเหตุ จึงลบอย่างชัดเจนภายใน transaction นี้เท่านั้น
 * ไฟล์หลักฐานอยู่คนละระบบกับ PostgreSQL จึงลบหลัง transaction สำเร็จ
 */
export async function deleteDrawPermanently(
  actor: Actor,
  drawId: string,
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<DeleteDrawOutcome> {
  requirePermission(actor, "draw.delete");

  const outcome = await prisma.$transaction(async (tx) => {
    const draw = await tx.draw.findFirst({
      where: { id: drawId, ...orgScope(actor) },
      select: {
        id: true,
        name: true,
        status: true,
        laoFamilyId: true,
        opensAt: true,
        cutoffAt: true,
        bills: {
          select: {
            id: true,
            attachments: { select: { id: true, storageKey: true } },
            payment: { select: { id: true } },
            _count: { select: { items: true } },
          },
        },
        _count: { select: { results: true, settlements: true, restrictedNumbers: true, capOverrides: true } },
      },
    });
    if (!draw) throw new NotFoundError("ไม่พบงวด");

    const storageKeys = draw.bills.flatMap((bill) => bill.attachments.map((item) => item.storageKey));
    const billIds = draw.bills.map((bill) => bill.id);
    const attachmentsDeleted = storageKeys.length;
    const billItemsDeleted = draw.bills.reduce((sum, bill) => sum + bill._count.items, 0);
    const paymentsDeleted = draw.bills.reduce((sum, bill) => sum + (bill.payment ? 1 : 0), 0);

    const settlements = await tx.settlement.deleteMany({ where: { drawId: draw.id } });
    const results = await tx.result.deleteMany({ where: { drawId: draw.id } });
    await tx.restrictedNumber.deleteMany({ where: { drawId: draw.id } });
    await tx.numberCapOverride.deleteMany({ where: { drawId: draw.id } });
    await tx.billAttachment.deleteMany({ where: { billId: { in: billIds } } });
    await tx.billPayment.deleteMany({ where: { billId: { in: billIds } } });
    await tx.billItem.deleteMany({ where: { billId: { in: billIds } } });
    await tx.bill.deleteMany({ where: { id: { in: billIds } } });
    await tx.draw.delete({ where: { id: draw.id } });
    if (draw.laoFamilyId) {
      // ถ้าลบเพียงฝั่งเดียว อีกฝั่งต้องกลับเป็นงวดเดี่ยว ไม่แสดงหรือทำงานเหมือนยังมีคู่
      await tx.draw.updateMany({
        where: { organizationId: actor.organizationId, laoFamilyId: draw.laoFamilyId },
        data: { laoFamilyId: null },
      });
    }

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "DELETE",
      entityType: "Draw",
      entityId: draw.id,
      before: {
        name: draw.name,
        status: draw.status,
        laoFamilyId: draw.laoFamilyId,
        opensAt: draw.opensAt.toISOString(),
        cutoffAt: draw.cutoffAt.toISOString(),
        bills: billIds.length,
        billItems: billItemsDeleted,
        attachments: attachmentsDeleted,
        payments: paymentsDeleted,
        results: draw._count.results,
        settlements: draw._count.settlements,
        restrictedNumbers: draw._count.restrictedNumbers,
        capOverrides: draw._count.capOverrides,
      },
      reason: "Owner ลบงวดและข้อมูลที่ผูกกับงวดถาวร",
    });

    return {
      storageKeys,
      result: {
        drawId: draw.id,
        drawName: draw.name,
        billsDeleted: billIds.length,
        billItemsDeleted,
        attachmentsDeleted,
        paymentsDeleted,
        resultsDeleted: results.count,
        settlementsDeleted: settlements.count,
      },
    };
  });

  await Promise.all(outcome.storageKeys.map(async (storageKey) => {
    try {
      await storage.delete(storageKey);
    } catch (error) {
      console.error("Draw deleted but evidence object cleanup failed", { storageKey, error });
    }
  }));
  return outcome.result;
}

/**
 * งานอัตโนมัติ: ปิดทุกงวดที่ถึงเวลา Cutoff แล้ว
 *
 * ไม่รับ Actor เพราะเรียกจาก scheduler ไม่ใช่จากผู้ใช้
 * ทำทีละงวดเพื่อให้งวดที่ล้มเหลวไม่ลากงวดอื่นตกไปด้วย
 */
export async function lockDueDraws(now: Date = new Date()): Promise<{
  locked: LockOutcome[];
  failed: { drawId: string; error: string }[];
}> {
  const due = await prisma.draw.findMany({
    where: { status: "OPEN", cutoffAt: { lte: now } },
    select: { id: true, lotteryType: true, laoFamilyId: true },
  });

  const locked: LockOutcome[] = [];
  const failed: { drawId: string; error: string }[] = [];

  const handled = new Set<string>();
  for (const draw of due) {
    const familyKey = (draw.lotteryType === "LAO" || draw.lotteryType === "LAO_SET") && draw.laoFamilyId
      ? `lao:${draw.laoFamilyId}`
      : `draw:${draw.id}`;
    if (handled.has(familyKey)) continue;
    handled.add(familyKey);
    try {
      locked.push(
        await lockDrawFamily(draw.id, { actorId: null, reason: "ถึงเวลาปิดรับอัตโนมัติ" }),
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

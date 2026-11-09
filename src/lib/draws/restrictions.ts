import { Prisma } from "@prisma/client";
import type { RestrictionKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizedNumber } from "@/lib/bills/betting";

/**
 * เลขเต็มและเลขอั้นของงวด
 *
 * - เลขเต็ม (CLOSED): ปิดรับ ระบบปฏิเสธรายการตอนยืนยันบิล
 * - เลขอั้น (REDUCED_RATE): ยังรับได้ แต่ snapshot อัตราจ่ายที่ลดลงตอนยืนยันบิล
 *
 * การเปลี่ยนแปลงมีผลเฉพาะบิลที่ยืนยันหลังจากนี้ บิลเดิมใช้อัตราที่ snapshot ไว้แล้ว
 */

export async function listRestrictions(actor: Actor, drawId: string) {
  return prisma.restrictedNumber.findMany({
    where: { ...orgScope(actor), drawId },
    orderBy: [{ kind: "asc" }, { prizeType: { code: "asc" } }, { number: "asc" }],
    select: {
      id: true,
      number: true,
      kind: true,
      payoutRate: true,
      prizeType: { select: { id: true, code: true, name: true, payoutRate: true } },
    },
  });
}

export type RestrictionInput = {
  drawId: string;
  prizeTypeId: string;
  number: string;
  kind: RestrictionKind;
  payoutRate?: string;
};

export async function addRestriction(actor: Actor, input: RestrictionInput): Promise<void> {
  requirePermission(actor, "draw.manage");

  const [draw, prizeType] = await Promise.all([
    prisma.draw.findFirst({ where: { ...orgScope(actor), id: input.drawId }, select: { id: true, status: true } }),
    prisma.prizeType.findFirst({
      where: { ...orgScope(actor), id: input.prizeTypeId, isActive: true },
      select: { id: true, name: true, digits: true, matchRule: true, payoutRate: true },
    }),
  ]);
  if (!draw) throw new NotFoundError("ไม่พบงวด");
  if (draw.status !== "OPEN") throw new ConflictError("ตั้งเลขเต็ม/เลขอั้นได้เฉพาะงวดที่ยังเปิดรับ");
  if (!prizeType) throw new NotFoundError("ไม่พบประเภทรางวัล");

  const raw = input.number.trim();
  if (!/^\d+$/.test(raw) || raw.length !== prizeType.digits) {
    throw new ValidationError(`${prizeType.name} ต้องเป็นตัวเลข ${prizeType.digits} หลัก`);
  }

  let payoutRate: Prisma.Decimal | null = null;
  if (input.kind === "REDUCED_RATE") {
    try {
      payoutRate = new Prisma.Decimal(input.payoutRate?.trim() || "x");
    } catch {
      throw new ValidationError("กรุณาระบุอัตราจ่ายของเลขอั้น");
    }
    if (payoutRate.lessThanOrEqualTo(0)) throw new ValidationError("อัตราจ่ายของเลขอั้นต้องมากกว่า 0");
    if (payoutRate.greaterThanOrEqualTo(prizeType.payoutRate)) {
      throw new ValidationError(`อัตราจ่ายเลขอั้นต้องต่ำกว่าอัตราปกติ (${prizeType.payoutRate.toFixed(2)})`);
    }
  }

  const number = normalizedNumber(raw, prizeType.matchRule);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.restrictedNumber.findUnique({
      where: { drawId_prizeTypeId_number: { drawId: draw.id, prizeTypeId: prizeType.id, number } },
      select: { id: true, kind: true, payoutRate: true },
    });

    const saved = existing
      ? await tx.restrictedNumber.update({
          where: { id: existing.id },
          data: { kind: input.kind, payoutRate },
          select: { id: true },
        })
      : await tx.restrictedNumber.create({
          data: {
            organizationId: actor.organizationId,
            drawId: draw.id,
            prizeTypeId: prizeType.id,
            number,
            kind: input.kind,
            payoutRate,
            createdById: actor.userId,
          },
          select: { id: true },
        });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "RestrictedNumber",
      entityId: saved.id,
      before: existing ? { kind: existing.kind, payoutRate: existing.payoutRate?.toFixed(4) ?? null } : undefined,
      after: { drawId: draw.id, prizeType: prizeType.name, number, kind: input.kind, payoutRate: payoutRate?.toFixed(4) ?? null },
    });
  });
}

export async function removeRestriction(actor: Actor, restrictionId: string): Promise<{ drawId: string }> {
  requirePermission(actor, "draw.manage");

  return prisma.$transaction(async (tx) => {
    const row = await tx.restrictedNumber.findFirst({
      where: { ...orgScope(actor), id: restrictionId },
      select: { id: true, drawId: true, number: true, kind: true, prizeType: { select: { name: true } }, draw: { select: { status: true } } },
    });
    if (!row) throw new NotFoundError("ไม่พบรายการเลขเต็ม/เลขอั้น");
    if (row.draw.status !== "OPEN") throw new ConflictError("แก้เลขเต็ม/เลขอั้นได้เฉพาะงวดที่ยังเปิดรับ");

    await tx.restrictedNumber.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CANCEL",
      entityType: "RestrictedNumber",
      entityId: row.id,
      before: { drawId: row.drawId, prizeType: row.prizeType.name, number: row.number, kind: row.kind },
      reason: "ยกเลิกเลขเต็ม/เลขอั้น",
    });
    return { drawId: row.drawId };
  });
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Rulebook ของรางวัล 1 ถึง 16
 *
 * ค่าเหล่านี้คือสิ่งที่ LOT-28 และ LOT-31 ต้องยืนยัน การย้ายมาแก้ในระบบ
 * แทนการฝังใน seed ทำให้ยืนยัน rulebook ได้โดยไม่ต้อง deploy ใหม่
 * และทุกการแก้มีร่องรอยใน Audit Log ว่าใครเปลี่ยนอะไรเมื่อไร
 *
 * การแก้อัตราจ่ายไม่กระทบบิลที่ยืนยันไปแล้ว เพราะ BillItem เก็บ
 * payoutRateSnapshot ของตัวเองไว้ตั้งแต่ตอนยืนยัน
 */

export type PrizeTypeInput = {
  name: string;
  digits: string;
  isPermutation: boolean;
  payoutRate: string;
  maxStakePerItem: string;
  isActive: boolean;
};

const MIN_DIGITS = 1;
const MAX_DIGITS = 6;

function parsePayoutRate(raw: string): Prisma.Decimal {
  let value: Prisma.Decimal;
  try {
    value = new Prisma.Decimal(raw);
  } catch {
    throw new ValidationError("อัตราจ่ายต้องเป็นตัวเลข");
  }
  if (value.lessThanOrEqualTo(0)) {
    throw new ValidationError("อัตราจ่ายต้องมากกว่า 0");
  }
  return value;
}

function parseDigits(raw: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < MIN_DIGITS || value > MAX_DIGITS) {
    throw new ValidationError(`จำนวนหลักต้องเป็นจำนวนเต็ม ${MIN_DIGITS} ถึง ${MAX_DIGITS}`);
  }
  return value;
}

function parseOptionalLimit(raw: string): Prisma.Decimal | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let value: Prisma.Decimal;
  try {
    value = new Prisma.Decimal(trimmed);
  } catch {
    throw new ValidationError("วงเงินต่อรายการต้องเป็นตัวเลข");
  }
  if (value.lessThanOrEqualTo(0)) {
    throw new ValidationError("วงเงินต่อรายการต้องมากกว่า 0 หรือเว้นว่างเพื่อไม่จำกัด");
  }
  return value;
}

export async function listPrizeTypes(actor: Actor) {
  requirePermission(actor, "bill.viewOwn");

  return prisma.prizeType.findMany({
    where: orgScope(actor),
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      digits: true,
      isPermutation: true,
      payoutRate: true,
      maxStakePerItem: true,
      isActive: true,
      updatedAt: true,
      _count: { select: { billItems: true } },
    },
  });
}

export async function updatePrizeType(
  actor: Actor,
  prizeTypeId: string,
  input: PrizeTypeInput,
  reason: string,
): Promise<void> {
  // ใช้สิทธิ์เดียวกับการจัดการรอบ เพราะเป็นการตั้งกติกาของระบบเหมือนกัน
  requirePermission(actor, "draw.manage");

  const name = input.name.trim();
  if (name === "") throw new ValidationError("ต้องกรอกชื่อรางวัล");

  const trimmedReason = reason.trim();
  if (trimmedReason === "") {
    throw new ValidationError("ต้องระบุเหตุผล เพื่อให้ตรวจย้อนหลังได้ว่าแก้เพราะอะไร");
  }

  const digits = parseDigits(input.digits);
  const payoutRate = parsePayoutRate(input.payoutRate);
  const maxStakePerItem = parseOptionalLimit(input.maxStakePerItem);

  const existing = await prisma.prizeType.findFirst({
    where: { id: prizeTypeId, ...orgScope(actor) },
    select: {
      id: true,
      code: true,
      name: true,
      digits: true,
      isPermutation: true,
      payoutRate: true,
      maxStakePerItem: true,
      isActive: true,
    },
  });
  if (!existing) throw new NotFoundError("ไม่พบประเภทรางวัล");

  await prisma.$transaction(async (tx) => {
    await tx.prizeType.update({
      where: { id: existing.id },
      data: {
        name,
        digits,
        isPermutation: input.isPermutation,
        payoutRate,
        maxStakePerItem,
        isActive: input.isActive,
      },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: "UPDATE",
      entityType: "PrizeType",
      entityId: existing.id,
      before: {
        name: existing.name,
        digits: existing.digits,
        isPermutation: existing.isPermutation,
        payoutRate: existing.payoutRate.toFixed(4),
        maxStakePerItem: existing.maxStakePerItem?.toFixed(2) ?? null,
        isActive: existing.isActive,
      },
      after: {
        name,
        digits,
        isPermutation: input.isPermutation,
        payoutRate: payoutRate.toFixed(4),
        maxStakePerItem: maxStakePerItem?.toFixed(2) ?? null,
        isActive: input.isActive,
      },
      reason: trimmedReason,
    });
  });
}

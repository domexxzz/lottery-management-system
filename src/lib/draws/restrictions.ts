import { Prisma, type MatchRule, type RestrictionKind } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizedNumber, permutations } from "@/lib/bills/betting";
import { reducedPayoutRate } from "@/lib/money";

/**
 * เลขเต็มและเลขอั้นของงวด
 *
 * - เลขเต็ม (CLOSED): ปิดรับ ระบบปฏิเสธรายการตอนยืนยันบิล
 * - เลขอั้น (REDUCED_RATE): ยังรับได้ แต่ snapshot อัตราเลขอั้นของประเภทนั้นตอนยืนยันบิล
 *
 * เลขอั้นมีผลกับทั้งบิลเดิมและบิลใหม่ในงวดที่ยังไม่คำนวณผล
 * บิลที่ SETTLED/CANCELLED แล้วไม่ถูกย้อนแก้ เพื่อรักษาประวัติการเงิน
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
};

export type RestrictionScope = "THREE_TOP" | "THREE_TOD" | "THREE_BOTH" | "TWO_TOP" | "TWO_BOTTOM" | "TWO_BOTH";

type RestrictionPrizeType = {
  id: string;
  code: number;
  name: string;
  digits: number;
  matchRule: MatchRule;
  payoutRate: Prisma.Decimal;
};

async function updatePendingItemRates(
  tx: Prisma.TransactionClient,
  actor: Actor,
  drawId: string,
  prizeType: RestrictionPrizeType,
  number: string,
  payoutRate: Prisma.Decimal,
): Promise<number> {
  const matchingNumbers = prizeType.matchRule === "PERMUTATION" ? permutations(number) : [number];
  const updated = await tx.billItem.updateMany({
    where: {
      organizationId: actor.organizationId,
      prizeTypeId: prizeType.id,
      number: { in: matchingNumbers },
      bill: { drawId, status: { in: ["CONFIRMED", "LOCKED"] } },
    },
    data: { payoutRateSnapshot: payoutRate },
  });
  return updated.count;
}

async function saveRestrictions(
  actor: Actor,
  draw: { id: string; status: string },
  prizeTypes: RestrictionPrizeType[],
  input: { number: string; kind: RestrictionKind },
): Promise<void> {
  if (draw.status !== "OPEN") throw new ConflictError("ตั้งเลขเต็ม/เลขอั้นได้เฉพาะงวดที่ยังเปิดรับ");
  if (prizeTypes.length === 0) throw new NotFoundError("ไม่พบประเภทรางวัล");

  const raw = input.number.trim();
  for (const prizeType of prizeTypes) {
    if (!/^\d+$/.test(raw) || raw.length !== prizeType.digits) {
      throw new ValidationError(`${prizeType.name} ต้องเป็นตัวเลข ${prizeType.digits} หลัก`);
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const prizeType of prizeTypes) {
      const payoutRate = input.kind === "REDUCED_RATE"
        ? reducedPayoutRate(prizeType.payoutRate, prizeType.code)
        : null;
      const number = normalizedNumber(raw, prizeType.matchRule);
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

      const effectiveRate = payoutRate ?? prizeType.payoutRate;
      const affectedBillItems = await updatePendingItemRates(
        tx,
        actor,
        draw.id,
        prizeType,
        number,
        effectiveRate,
      );

      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: existing ? "UPDATE" : "CREATE",
        entityType: "RestrictedNumber",
        entityId: saved.id,
        before: existing ? { kind: existing.kind, payoutRate: existing.payoutRate?.toFixed(4) ?? null } : undefined,
        after: { drawId: draw.id, prizeType: prizeType.name, number, kind: input.kind, payoutRate: payoutRate?.toFixed(4) ?? null, affectedBillItems },
      });
    }
  });
}

export async function addRestriction(actor: Actor, input: RestrictionInput): Promise<void> {
  requirePermission(actor, "draw.manage");

  const [draw, prizeType] = await Promise.all([
    prisma.draw.findFirst({ where: { ...orgScope(actor), id: input.drawId }, select: { id: true, status: true } }),
    prisma.prizeType.findFirst({
      where: { ...orgScope(actor), id: input.prizeTypeId, isActive: true },
      select: { id: true, code: true, name: true, digits: true, matchRule: true, payoutRate: true },
    }),
  ]);
  if (!draw) throw new NotFoundError("ไม่พบงวด");
  if (!prizeType) throw new NotFoundError("ไม่พบประเภทรางวัล");
  await saveRestrictions(actor, draw, [prizeType], input);
}

export async function addScopedRestriction(
  actor: Actor,
  input: { drawId: string; scope: RestrictionScope; number: string; kind: RestrictionKind },
): Promise<void> {
  requirePermission(actor, "draw.manage");
  const codesByScope: Record<RestrictionScope, number[]> = {
    THREE_TOP: [1],
    THREE_TOD: [2],
    THREE_BOTH: [1, 2],
    TWO_TOP: [5],
    TWO_BOTTOM: [6],
    TWO_BOTH: [5, 6],
  };
  const codes = codesByScope[input.scope];
  const [draw, prizeTypes] = await Promise.all([
    prisma.draw.findFirst({ where: { ...orgScope(actor), id: input.drawId }, select: { id: true, status: true } }),
    prisma.prizeType.findMany({
      where: { ...orgScope(actor), code: { in: codes }, isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, digits: true, matchRule: true, payoutRate: true },
    }),
  ]);
  if (!draw) throw new NotFoundError("ไม่พบงวด");
  if (prizeTypes.length !== codes.length) throw new NotFoundError("ประเภทรางวัลในขอบเขตนี้ยังเปิดใช้ไม่ครบ");
  await saveRestrictions(actor, draw, prizeTypes, input);
}

export async function removeRestriction(actor: Actor, restrictionId: string): Promise<{ drawId: string }> {
  requirePermission(actor, "draw.manage");

  return prisma.$transaction(async (tx) => {
    const row = await tx.restrictedNumber.findFirst({
      where: { ...orgScope(actor), id: restrictionId },
      select: {
        id: true,
        drawId: true,
        number: true,
        kind: true,
        prizeType: { select: { id: true, code: true, name: true, digits: true, matchRule: true, payoutRate: true } },
        draw: { select: { status: true } },
      },
    });
    if (!row) throw new NotFoundError("ไม่พบรายการเลขเต็ม/เลขอั้น");
    if (row.draw.status !== "OPEN") throw new ConflictError("แก้เลขเต็ม/เลขอั้นได้เฉพาะงวดที่ยังเปิดรับ");

    await tx.restrictedNumber.delete({ where: { id: row.id } });
    const affectedBillItems = await updatePendingItemRates(
      tx,
      actor,
      row.drawId,
      row.prizeType,
      row.number,
      row.prizeType.payoutRate,
    );
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CANCEL",
      entityType: "RestrictedNumber",
      entityId: row.id,
      before: { drawId: row.drawId, prizeType: row.prizeType.name, number: row.number, kind: row.kind, affectedBillItems },
      reason: "ยกเลิกเลขเต็ม/เลขอั้น",
    });
    return { drawId: row.drawId };
  });
}

/**
 * เปลี่ยนเพดานรับต่อเลขของงวด (ค่าเริ่มต้น 2,000 บาท)
 *
 * มีผลกับบิลที่ยืนยันหลังจากนี้ บิลที่ยืนยันไปแล้วไม่ถูกย้อนแก้
 * เว้นว่าง = ไม่จำกัด
 */
export async function updateNumberCap(actor: Actor, drawId: string, rawValue: string): Promise<void> {
  requirePermission(actor, "draw.manage");
  const raw = rawValue.replace(/,/g, "").trim();
  let cap: Prisma.Decimal | null = null;
  if (raw !== "") {
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) {
      throw new ValidationError("เพดานต่อเลขต้องเป็นจำนวนเงินมากกว่า 0 หรือเว้นว่างถ้าไม่จำกัด");
    }
    if (Number(raw) > 100_000_000) throw new ValidationError("เพดานต่อเลขสูงเกินไป");
    cap = new Prisma.Decimal(raw);
  }

  await prisma.$transaction(async (tx) => {
    const draw = await tx.draw.findFirst({
      where: { ...orgScope(actor), id: drawId },
      select: { id: true, status: true, numberCap: true },
    });
    if (!draw) throw new NotFoundError("ไม่พบงวด");
    if (draw.status !== "OPEN") throw new ConflictError("แก้เพดานต่อเลขได้เฉพาะงวดที่ยังเปิดรับ");
    await tx.draw.update({ where: { id: draw.id }, data: { numberCap: cap } });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "UPDATE",
      entityType: "Draw",
      entityId: draw.id,
      before: { numberCap: draw.numberCap?.toFixed(2) ?? null },
      after: { numberCap: cap?.toFixed(2) ?? null },
      reason: "เปลี่ยนเพดานรับต่อเลข",
    });
  });
}

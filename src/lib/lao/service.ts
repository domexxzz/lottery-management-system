import { randomUUID } from "node:crypto";
import { Prisma, type LotteryType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizedNumber } from "@/lib/bills/betting";
import { parseBangkokDateTimeLocal } from "@/lib/draws/schedule";
import { enterResultsBatch } from "@/lib/results/service";
import { isLaoLottery, LAO_DEFAULT_TIMES, LAO_SET_ACTIVE_CODES, laoResultForCode, laoResultProblem } from "./rules";

/**
 * งานของหวยลาว/หวยลาวชุด ที่ต่างจากหวยไทย
 *
 * - หวยลาวกับหวยลาวชุดที่เลือกสร้างพร้อมกันเป็นคนละงวด (คนละเพดาน คนละบิล คนละรายงาน)
 *   แต่มีรหัสคู่ร่วมกัน ใช้ผลชุดเดียวกัน และลงผลครั้งเดียวระบบบันทึกให้ทั้งสองงวด
 */

const THAI_DATE = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export const LAO_LOTTERY_LABEL: Record<"LAO" | "LAO_SET", string> = { LAO: "หวยลาว", LAO_SET: "หวยลาวชุด" };

export function laoDrawName(lotteryType: "LAO" | "LAO_SET", drawDate: string): string {
  const [year, month, day] = drawDate.split("-").map(Number);
  return `${LAO_LOTTERY_LABEL[lotteryType]} ${THAI_DATE.format(new Date(Date.UTC(year!, month! - 1, day!)))}`;
}

// ---------------------------------------------------------------- สร้างงวด

export type LaoDrawInput = {
  drawDate: string;
  opensAt: string;
  cutoffAt: string;
  /** เวลาออกผล "YYYY-MM-DDTHH:mm" ค่าเริ่มต้นวันงวด 20:30 */
  resultAt?: string;
  lotteryTypes: readonly ("LAO" | "LAO_SET")[];
};

/** สร้างงวดหวยลาวและ/หรือหวยลาวชุดของวันเดียวกันในครั้งเดียว */
export async function createLaoDraws(actor: Actor, input: LaoDrawInput): Promise<{ drawIds: string[]; duplicates: string[] }> {
  requirePermission(actor, "draw.manage");
  // ปกติหวยลาวออกจันทร์–ศุกร์ แต่บางงวดเลื่อนวัน จึงให้เลือกวันอื่นได้ (หน้าจอเตือนเอง)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.drawDate) || Number.isNaN(Date.parse(`${input.drawDate}T00:00:00Z`))) {
    throw new ValidationError("วันออกผลไม่ถูกต้อง");
  }
  const types = [...new Set(input.lotteryTypes)];
  if (types.length === 0) throw new ValidationError("เลือกอย่างน้อยหนึ่งประเภท: หวยลาว หรือหวยลาวชุด");
  const opensAt = parseBangkokDateTimeLocal(input.opensAt);
  const cutoffAt = parseBangkokDateTimeLocal(input.cutoffAt);
  if (!opensAt) throw new ValidationError("เวลาเปิดรับไม่ถูกต้อง");
  if (!cutoffAt) throw new ValidationError("เวลาปิดรับไม่ถูกต้อง");
  if (cutoffAt.getTime() <= opensAt.getTime()) throw new ValidationError("เวลาปิดรับต้องอยู่หลังเวลาเปิดรับ");
  const resultAt = parseBangkokDateTimeLocal(input.resultAt ?? `${input.drawDate}T${LAO_DEFAULT_TIMES.result}`);
  if (!resultAt) throw new ValidationError("เวลาออกผลไม่ถูกต้อง");
  if (resultAt.getTime() < cutoffAt.getTime()) throw new ValidationError("เวลาออกผลต้องไม่ก่อนเวลาปิดรับ");
  const [year, month, day] = input.drawDate.split("-").map(Number);
  const drawDate = new Date(Date.UTC(year!, month! - 1, day!));
  const laoFamilyId = types.length === 2 ? randomUUID() : null;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.draw.findMany({
      where: { ...orgScope(actor), drawDate, lotteryType: { in: types } },
      select: { lotteryType: true },
    });
    // สร้างซ้ำวันเดียวกันได้ (เหมือนหวยรัฐบาล) ระบบเก็บเป็นคนละงวดและแจ้งว่าเป็นงวดซ้ำ
    const duplicates = [...new Set(existing.map((row) => LAO_LOTTERY_LABEL[row.lotteryType as "LAO" | "LAO_SET"]))];
    const drawIds: string[] = [];
    for (const lotteryType of types) {
      const created = await tx.draw.create({
        data: {
          organizationId: actor.organizationId,
          name: laoDrawName(lotteryType, input.drawDate),
          lotteryType,
          drawDate,
          laoFamilyId,
          opensAt,
          cutoffAt,
          resultAt,
          status: "OPEN",
        },
        select: { id: true, name: true },
      });
      drawIds.push(created.id);
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
          lotteryType,
          laoFamilyId,
          opensAt: opensAt.toISOString(),
          cutoffAt: cutoffAt.toISOString(),
          resultAt: resultAt.toISOString(),
          duplicate: existing.some((row) => row.lotteryType === lotteryType),
        },
      });
    }
    return { drawIds, duplicates };
  });
}

// ---------------------------------------------------------------- ลงผล

/** งวดหวยลาว/หวยลาวชุดที่สร้างเป็นคู่และใช้ผลร่วมกัน (รวมงวดที่ระบุ) */
export async function laoSiblingDraws(actor: Actor, drawId: string) {
  const draw = await prisma.draw.findFirst({
    where: { ...orgScope(actor), id: drawId },
    select: { id: true, lotteryType: true, laoFamilyId: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบงวด");
  if (!isLaoLottery(draw.lotteryType)) throw new ValidationError("งวดนี้ไม่ใช่หวยลาว");
  if (!draw.laoFamilyId) return [draw.id];
  const rows = await prisma.draw.findMany({
    where: {
      ...orgScope(actor),
      laoFamilyId: draw.laoFamilyId,
      lotteryType: { in: ["LAO", "LAO_SET"] },
    },
    orderBy: { lotteryType: "asc" },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/**
 * ลงผลหวยลาวจากเลขที่ออกเต็ม (4–6 หลัก) ระบบแยกเป็นผลของทุกประเภทรางวัลเอง
 *
 * บันทึกให้ทุกงวดหวยลาว/หวยลาวชุดในคู่เดียวกันที่ปิดรับแล้วและยังไม่มีผล
 * ใช้เส้นทางบันทึกผลเดิม (enterResultsBatch) จึงได้ Audit และกติกาอนุมัติเหมือนหวยไทย
 */
export async function enterLaoResult(
  actor: Actor,
  drawId: string,
  raw: string,
): Promise<{ saved: { drawId: string; autoApproved: boolean }[]; skipped: string[] }> {
  requirePermission(actor, "result.enter");
  const officialNumber = raw.trim();
  const problem = laoResultProblem(officialNumber);
  if (problem) throw new ValidationError(problem);

  const siblingIds = await laoSiblingDraws(actor, drawId);
  const draws = await prisma.draw.findMany({
    where: { ...orgScope(actor), id: { in: siblingIds } },
    select: {
      id: true,
      name: true,
      status: true,
      lotteryType: true,
      officialNumber: true,
      results: { where: { status: "APPROVED" }, select: { id: true }, take: 1 },
    },
  });
  const existingOfficialNumber = draws.find((draw) => draw.officialNumber)?.officialNumber;
  if (existingOfficialNumber && existingOfficialNumber !== officialNumber) {
    throw new ConflictError(`คู่งวดนี้ประกาศผล ${existingOfficialNumber} แล้ว ถ้าผลผิดให้ใช้เมนูแก้ผลที่ประกาศแล้ว`);
  }
  const hasReadySibling = draws.some((draw) =>
    (draw.status === "LOCKED" || draw.status === "RESULT_PENDING") && draw.results.length === 0
  );
  const saved: { drawId: string; autoApproved: boolean }[] = [];
  const skipped: string[] = [];
  for (const draw of draws) {
    const ready = (draw.status === "LOCKED" || draw.status === "RESULT_PENDING") && draw.results.length === 0;
    if (!ready) {
      // รองรับซ่อมกรณีรุ่นก่อนบันทึกสำเร็จเพียงฝั่งเดียว: ฝั่งที่มีผลแล้วไม่ขวางการเติมผลให้งวดคู่
      if (draw.results.length > 0 && hasReadySibling) continue;
      // งวดที่ระบุตรง ๆ ต้องลงผลได้ ถ้าไม่ได้ให้บอกเหตุผล ส่วนงวดคู่ข้ามไปเงียบ ๆ
      if (draw.id === drawId) {
        if (draw.results.length > 0) throw new ConflictError("งวดนี้มีผลแล้ว ถ้าผลผิดให้ใช้เมนูแก้ผลที่ประกาศแล้ว");
        throw new ConflictError("ลงผลได้เฉพาะงวดที่ปิดรับแล้วและยังไม่ปิดบัญชี");
      }
      skipped.push(draw.name);
      continue;
    }
    const prizeTypes = await prisma.prizeType.findMany({
      where: {
        ...orgScope(actor),
        lotteryType: draw.lotteryType as LotteryType,
        OR: [
          {
            isActive: true,
            ...(draw.lotteryType === "LAO_SET" ? { code: { in: [...LAO_SET_ACTIVE_CODES] } } : {}),
          },
          // บิลเก่าก่อนปิดประเภทยังต้องมีผลเพื่อคำนวณรางวัลถูกต้อง
          { billItems: { some: { bill: { drawId: draw.id, status: { notIn: ["DRAFT", "CANCELLED"] } } } } },
        ],
      },
      select: { id: true, code: true },
    });
    const results = prizeTypes.flatMap((prizeType) => {
      const value = laoResultForCode(prizeType.code, officialNumber);
      return value === null ? [] : [{ prizeTypeId: prizeType.id, values: [value] }];
    });
    if (results.length === 0) continue;
    const outcome = await enterResultsBatch(actor, { drawId: draw.id, results });
    await prisma.draw.update({ where: { id: draw.id }, data: { officialNumber } });
    saved.push({ drawId: draw.id, autoApproved: outcome.autoApproved });
  }
  return { saved, skipped };
}

// ---------------------------------------------------------------- เพดานเฉพาะเลข

export async function listCapOverrides(actor: Actor, drawId: string) {
  requirePermission(actor, "draw.manage");
  return prisma.numberCapOverride.findMany({
    where: { ...orgScope(actor), drawId },
    orderBy: [{ prizeType: { code: "asc" } }, { number: "asc" }],
    select: { id: true, number: true, cap: true, prizeType: { select: { id: true, code: true, name: true } } },
  });
}

/**
 * Owner ตั้งเพดานเฉพาะเลข (ทับเพดานทั้งงวด) ใช้ทั้งปลดเลขเต็มและลดเพดานเลขเสี่ยง
 * มีผลกับบิลที่ยืนยันหลังจากนี้ บิลเดิมไม่ถูกแตะ
 */
export async function setCapOverride(
  actor: Actor,
  input: { drawId: string; prizeTypeId: string; number: string; cap: string },
): Promise<void> {
  requirePermission(actor, "number.capOverride");
  const draw = await prisma.draw.findFirst({
    where: { ...orgScope(actor), id: input.drawId },
    select: { id: true, status: true, lotteryType: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบงวด");
  if (draw.status !== "OPEN") throw new ConflictError("ตั้งเพดานเฉพาะเลขได้เฉพาะงวดที่ยังเปิดรับ");
  const prizeType = await prisma.prizeType.findFirst({
    where: {
      ...orgScope(actor),
      id: input.prizeTypeId,
      lotteryType: draw.lotteryType,
      ...(draw.lotteryType === "LAO_SET" ? { code: { in: [...LAO_SET_ACTIVE_CODES] } } : {}),
    },
    select: { id: true, name: true, digits: true, matchRule: true },
  });
  if (!prizeType) throw new NotFoundError("ไม่พบประเภทรางวัลของงวดนี้");
  const number = input.number.trim();
  if (!/^\d+$/.test(number) || number.length !== prizeType.digits) {
    throw new ValidationError(`${prizeType.name} ต้องเป็นตัวเลข ${prizeType.digits} หลัก`);
  }
  const rawCap = input.cap.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(rawCap)) throw new ValidationError("เพดานต้องเป็นจำนวนเงิน (0 ขึ้นไป)");
  const cap = new Prisma.Decimal(rawCap);
  if (cap.greaterThan(100_000_000)) throw new ValidationError("เพดานสูงเกินไป");
  const normalized = normalizedNumber(number, prizeType.matchRule);

  await prisma.$transaction(async (tx) => {
    const existing = await tx.numberCapOverride.findUnique({
      where: { drawId_prizeTypeId_number: { drawId: draw.id, prizeTypeId: prizeType.id, number: normalized } },
      select: { id: true, cap: true },
    });
    const saved = await tx.numberCapOverride.upsert({
      where: { drawId_prizeTypeId_number: { drawId: draw.id, prizeTypeId: prizeType.id, number: normalized } },
      update: { cap },
      create: { organizationId: actor.organizationId, drawId: draw.id, prizeTypeId: prizeType.id, number: normalized, cap, createdById: actor.userId },
      select: { id: true },
    });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "NumberCapOverride",
      entityId: saved.id,
      before: existing ? { cap: existing.cap.toFixed(2) } : undefined,
      after: { drawId: draw.id, prizeType: prizeType.name, number: normalized, cap: cap.toFixed(2) },
      reason: "ตั้งเพดานเฉพาะเลข",
    });
  });
}

export async function removeCapOverride(actor: Actor, overrideId: string): Promise<{ drawId: string }> {
  requirePermission(actor, "number.capOverride");
  const row = await prisma.numberCapOverride.findFirst({
    where: { ...orgScope(actor), id: overrideId },
    select: { id: true, drawId: true, number: true, cap: true, prizeType: { select: { name: true } }, draw: { select: { status: true } } },
  });
  if (!row) throw new NotFoundError("ไม่พบเพดานเฉพาะเลข");
  if (row.draw.status !== "OPEN") throw new ConflictError("แก้เพดานเฉพาะเลขได้เฉพาะงวดที่ยังเปิดรับ");
  await prisma.$transaction(async (tx) => {
    await tx.numberCapOverride.delete({ where: { id: row.id } });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CANCEL",
      entityType: "NumberCapOverride",
      entityId: row.id,
      before: { drawId: row.drawId, prizeType: row.prizeType.name, number: row.number, cap: row.cap.toFixed(2) },
      reason: "ยกเลิกเพดานเฉพาะเลข กลับไปใช้เพดานทั้งงวด",
    });
  });
  return { drawId: row.drawId };
}

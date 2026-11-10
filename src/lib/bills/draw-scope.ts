import type { DrawStatus, Prisma } from "@prisma/client";
import { drawDay } from "@/lib/draws/range";
import type { DrawScope } from "./history-filter";

/** งวดยังอยู่ในงวดปัจจุบันต่ออีกกี่วันหลังวันออกรางวัล */
export const CURRENT_GRACE_DAYS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

type ScopeInput = { status: DrawStatus; cutoffAt: Date; drawDate: Date | null };

/**
 * วันออกรางวัลวันแรกที่ยังนับเป็นงวดปัจจุบัน (YYYY-MM-DD เวลาไทย)
 *
 * งวดวันที่ 16 อยู่ในงวดปัจจุบันถึงสิ้นวันที่ 17 และย้ายไปงวดย้อนหลังตั้งแต่วันที่ 18
 * ช่วงนี้แอดมินยังต้องตรวจรางวัล จ่ายเงิน และตามบิลของงวดที่เพิ่งออก
 */
export function oldestCurrentDrawDay(now: Date): string {
  return new Date(now.getTime() + BANGKOK_OFFSET_MS - (CURRENT_GRACE_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * งวดปัจจุบัน = งวดที่เปิดรับอยู่ หรือออกรางวัลมาแล้วยังไม่เกิน 2 วัน (แม้ปิดรับหรือตรวจผลแล้ว)
 * งวดย้อนหลัง = งวดที่ออกรางวัลเกิน 2 วันแล้ว
 */
export function scopeOfDraw(draw: ScopeInput, now: Date): "current" | "past" {
  if (draw.status === "OPEN" && draw.cutoffAt.getTime() > now.getTime()) return "current";
  return drawDay(draw) >= oldestCurrentDrawDay(now) ? "current" : "past";
}

function currentWhere(now: Date): Prisma.DrawWhereInput {
  const day = oldestCurrentDrawDay(now);
  return {
    OR: [
      { status: "OPEN", cutoffAt: { gt: now } },
      // drawDate เก็บเป็นเที่ยงคืน UTC ของวันออกรางวัล
      { drawDate: { gte: new Date(`${day}T00:00:00Z`) } },
      // งวดที่ไม่มี drawDate ใช้วันปิดรับตามเวลาไทยแทน (ตรงกับ drawDay)
      { drawDate: null, cutoffAt: { gte: new Date(`${day}T00:00:00+07:00`) } },
    ],
  };
}

/** เงื่อนไขงวดตามขอบเขต; undefined = ไม่จำกัด */
export function drawWhereOf(scope: DrawScope, now: Date): Prisma.DrawWhereInput | undefined {
  if (scope === "current") return currentWhere(now);
  if (scope === "past") {
    // เขียนตรงข้ามของ currentWhere แบบชัดเจน ไม่ใช้ NOT ครอบ OR
    // เพราะ drawDate ที่เป็น NULL ทำให้ NOT(...) ได้ NULL และงวดนั้นจะหายไปจากทั้งสองฝั่ง
    const day = oldestCurrentDrawDay(now);
    return {
      AND: [
        { NOT: { status: "OPEN", cutoffAt: { gt: now } } },
        {
          OR: [
            { drawDate: { lt: new Date(`${day}T00:00:00Z`) } },
            { drawDate: null, cutoffAt: { lt: new Date(`${day}T00:00:00+07:00`) } },
          ],
        },
      ],
    };
  }
  return undefined;
}

/** งวดค่าเริ่มต้นของหน้าบิล: งวดปัจจุบันที่ปิดรับเร็วที่สุด (งวดที่เพิ่งออกก่อน แล้วจึงงวดถัดไป) */
export function pickCurrentDraw<T extends ScopeInput>(draws: readonly T[], now: Date): T | null {
  let best: T | null = null;
  for (const draw of draws) {
    if (scopeOfDraw(draw, now) !== "current") continue;
    if (!best || draw.cutoffAt.getTime() < best.cutoffAt.getTime()) best = draw;
  }
  return best;
}

export type DrawStageTone = "future" | "open" | "locked" | "done";

/** ขั้นตอนของงวดสำหรับป้ายบนหน้าบิล */
export function drawStage(
  draw: { status: DrawStatus; opensAt: Date; cutoffAt: Date },
  now: Date,
): { label: string; tone: DrawStageTone } {
  switch (draw.status) {
    case "OPEN":
      if (draw.opensAt.getTime() > now.getTime()) return { label: "ยังไม่เปิดรับ", tone: "future" };
      if (draw.cutoffAt.getTime() > now.getTime()) return { label: "เปิดรับอยู่", tone: "open" };
      return { label: "ถึงเวลาปิดรับ", tone: "locked" };
    case "LOCKED":
      return { label: "ปิดรับแล้ว · รอผล", tone: "locked" };
    case "RESULT_PENDING":
      return { label: "รอตรวจรางวัล", tone: "locked" };
    case "SETTLED":
      return { label: "ตรวจรางวัลแล้ว", tone: "done" };
    case "CLOSED":
      return { label: "ปิดบัญชีแล้ว", tone: "done" };
  }
}

/** เวลาที่เหลือก่อนปิดรับ เช่น "เหลือ 6 วัน 3 ชม."; null เมื่อเลยเวลาแล้ว */
export function timeLeftLabel(until: Date, now: Date): string | null {
  const minutes = Math.floor((until.getTime() - now.getTime()) / 60_000);
  if (minutes <= 0) return null;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return hours > 0 ? `เหลือ ${days} วัน ${hours} ชม.` : `เหลือ ${days} วัน`;
  if (hours > 0) return `เหลือ ${hours} ชม. ${minutes % 60} นาที`;
  return `เหลือ ${minutes} นาที`;
}

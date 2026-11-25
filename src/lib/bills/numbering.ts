import type { LotteryType } from "@prisma/client";

const SEQUENCE_WIDTH = 4;
const PUBLIC_SEQUENCE_WIDTH = 2;
const BANGKOK_TIME_ZONE = "Asia/Bangkok";

const LOTTERY_TYPE_CODE: Record<LotteryType, string> = {
  THAI_GOVERNMENT: "01",
  LAO: "02",
  LAO_SET: "03",
};

function bangkokDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    timeZone: BANGKOK_TIME_ZONE,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return { day: part("day"), month: part("month"), year: part("year") };
}

function compactBangkokDate(value: Date): string {
  const part = bangkokDateParts(value);
  return `${part.day}${part.month}${part.year}`;
}

/** คีย์ตัวนับรายงวดของ Agent (ข้อมูลเก่ายังคงคีย์ YYYY-MM ไว้เพื่อประวัติ) */
export function billSequencePeriod(drawId: string): string {
  return `draw:${drawId}`;
}

/** รหัสภายใน ห้ามนำไปแสดงใน UI */
export function buildInternalBillNumber(input: {
  agentCode: string;
  lotteryType: LotteryType;
  issuedAt: Date;
  drawSequence: number;
  drawId: string;
}): string {
  const sequence = input.drawSequence.toString().padStart(SEQUENCE_WIDTH, "0");
  return `${input.agentCode}${LOTTERY_TYPE_CODE[input.lotteryType]}${compactBangkokDate(input.issuedAt)}${sequence}-${input.drawId}`;
}

/** รหัสที่ลูกค้าเห็น: ประเภทหวย + วันเดือนปีของงวด + เลขบิลรายงวด เช่น T25112601 */
export function publicBillCode(input: {
  drawSequence: number | null | undefined;
  lotteryTypes: readonly LotteryType[];
  drawDate: Date | null;
  cutoffAt: Date;
}): string | null {
  if (input.drawSequence === null || input.drawSequence === undefined) return null;
  const prefix = `${input.lotteryTypes.includes("THAI_GOVERNMENT") ? "T" : ""}${input.lotteryTypes.some((type) => type === "LAO" || type === "LAO_SET") ? "L" : ""}`;
  const date = input.drawDate ?? new Date(input.cutoffAt.getTime() + 7 * 60 * 60 * 1000);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = String(date.getUTCFullYear()).slice(-2);
  return `${prefix}${day}${month}${year}${String(input.drawSequence).padStart(PUBLIC_SEQUENCE_WIDTH, "0")}`;
}

export function publicSlipCode(drawSequence: number | null | undefined, parts: readonly { draw: { lotteryType: LotteryType; drawDate: Date | null; cutoffAt: Date } }[]): string | null {
  const anchor = parts.find((part) => part.draw.lotteryType === "THAI_GOVERNMENT") ?? parts[0];
  if (!anchor) return null;
  return publicBillCode({
    drawSequence,
    lotteryTypes: parts.map((part) => part.draw.lotteryType),
    drawDate: anchor.draw.drawDate,
    cutoffAt: anchor.draw.cutoffAt,
  });
}

/** เลขที่ผู้ใช้เห็น เช่น “บิล 1” โดยไม่เปิดเผยรหัสภายใน */
export function visibleBillNumber(drawSequence: number | null | undefined): string {
  return drawSequence === null || drawSequence === undefined ? "บิลร่าง" : `บิล ${drawSequence}`;
}

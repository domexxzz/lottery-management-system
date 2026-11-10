import type { LotteryType } from "@prisma/client";

const SEQUENCE_WIDTH = 4;
const BANGKOK_TIME_ZONE = "Asia/Bangkok";

const LOTTERY_TYPE_CODE: Record<LotteryType, string> = {
  THAI_GOVERNMENT: "01",
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

/** คีย์เดือนสำหรับตัวนับเลขบิล โดยยึดวันปฏิทิน Asia/Bangkok */
export function billSequencePeriod(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: BANGKOK_TIME_ZONE,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}`;
}

/** รหัสภายใน ห้ามนำไปแสดงใน UI */
export function buildInternalBillNumber(input: {
  agentCode: string;
  lotteryType: LotteryType;
  issuedAt: Date;
  drawSequence: number;
}): string {
  const sequence = input.drawSequence.toString().padStart(SEQUENCE_WIDTH, "0");
  return `${input.agentCode}${LOTTERY_TYPE_CODE[input.lotteryType]}${compactBangkokDate(input.issuedAt)}${sequence}`;
}

/** เลขที่ผู้ใช้เห็น เช่น “บิล 1” โดยไม่เปิดเผยรหัสภายใน */
export function visibleBillNumber(drawSequence: number | null | undefined): string {
  return drawSequence === null || drawSequence === undefined ? "บิลร่าง" : `บิล ${drawSequence}`;
}

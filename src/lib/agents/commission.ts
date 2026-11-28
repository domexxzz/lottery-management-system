import type { LotteryType, Prisma } from "@prisma/client";

export type AgentCommissionRates = {
  commissionRate: Prisma.Decimal;
  laoCommissionRate: Prisma.Decimal;
};

export type AgentCommissionPromotion = AgentCommissionRates & {
  commissionPromotionStartsOn: Date | null;
  commissionPromotionEndsOn: Date | null;
  commissionPromotionThaiMinGross: Prisma.Decimal | null;
  commissionPromotionLaoMinGross: Prisma.Decimal | null;
  commissionPromotionThaiRate: Prisma.Decimal | null;
  commissionPromotionLaoRate: Prisma.Decimal | null;
};

/** เลือกอัตราคอมตามประเภทหวย โดยหวยลาวปกติและหวยลาวชุดใช้อัตราเดียวกัน */
export function commissionRateForLottery(
  agent: AgentCommissionRates,
  lotteryType: LotteryType,
): Prisma.Decimal {
  return lotteryType === "THAI_GOVERNMENT" ? agent.commissionRate : agent.laoCommissionRate;
}

/**
 * วันของคอลัมน์ @db.Date
 *
 * Prisma คืนค่าคอลัมน์ Date เป็น Date ที่เที่ยงคืน UTC เสมอ การตัด 10 ตัวแรกของ
 * ISO string จึงได้วันตามปฏิทินที่กรอกไว้ตรง ๆ ไม่ต้องแปลงเขตเวลาซ้ำ
 */
function databaseDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** กลุ่มหวยที่ใช้เกณฑ์โปรโมชั่นร่วมกัน หวยลาวกับหวยลาวชุดนับเป็นกลุ่มเดียว */
export type PromotionLotteryGroup = "THAI" | "LAO";

export function promotionGroupOf(lotteryType: LotteryType): PromotionLotteryGroup {
  return lotteryType === "THAI_GOVERNMENT" ? "THAI" : "LAO";
}

/** เกณฑ์โปรโมชั่นของกลุ่มหวยหนึ่ง null = ไม่ได้ตั้งไว้สำหรับกลุ่มนี้ */
export type PromotionTarget = { minGross: Prisma.Decimal; rate: Prisma.Decimal };

export function promotionTargetFor(
  agent: AgentCommissionPromotion,
  group: PromotionLotteryGroup,
): PromotionTarget | null {
  const minGross = group === "THAI" ? agent.commissionPromotionThaiMinGross : agent.commissionPromotionLaoMinGross;
  const rate = group === "THAI" ? agent.commissionPromotionThaiRate : agent.commissionPromotionLaoRate;
  if (!minGross || !rate) return null;
  return { minGross, rate };
}

export function hasPromotion(agent: AgentCommissionPromotion): boolean {
  if (!agent.commissionPromotionStartsOn || !agent.commissionPromotionEndsOn) return false;
  return promotionTargetFor(agent, "THAI") !== null || promotionTargetFor(agent, "LAO") !== null;
}

/** ผลการเลือกอัตราคอมของงวดหนึ่ง เก็บเหตุผลไว้ด้วยเพื่ออธิบายตัวเลขย้อนหลังได้ */
export type CommissionDecision = {
  /** อัตราที่ใช้จริง */
  rate: Prisma.Decimal;
  /** อัตราปกติที่จะใช้ถ้าไม่มีโปรโมชั่น */
  baseRate: Prisma.Decimal;
  promotionApplied: boolean;
};

/**
 * เลือกอัตราคอมสุดท้ายของงวด พร้อมเหตุผล
 *
 * โปรโมชั่นคิดจากยอดขายของ Agent ในงวดนั้น ไม่ใช่ยอดสะสมข้ามงวด เพื่อให้ Settlement
 * ปิดบัญชีและตรวจย้อนหลังได้แน่นอนตั้งแต่งวดจบ โดยไม่ต้องย้อนแก้ยอดงวดที่อนุมัติแล้ว
 *
 * คืน baseRate มาด้วยเสมอ เพราะหน้าจอที่แสดงค่าคอมต้องตอบ Agent ได้ว่า
 * "ทำไมงวดนี้ได้ 32% งวดก่อนได้ 30%" ถ้าเก็บแต่อัตราสุดท้ายจะอธิบายไม่ได้
 */
export function commissionDecision(input: {
  agent: AgentCommissionPromotion;
  lotteryType: LotteryType;
  drawDay: string;
  gross: Prisma.Decimal;
}): CommissionDecision {
  const baseRate = commissionRateForLottery(input.agent, input.lotteryType);
  const miss: CommissionDecision = { rate: baseRate, baseRate, promotionApplied: false };

  const startsOn = input.agent.commissionPromotionStartsOn;
  const endsOn = input.agent.commissionPromotionEndsOn;
  if (!startsOn || !endsOn) return miss;
  if (input.drawDay < databaseDay(startsOn) || input.drawDay > databaseDay(endsOn)) return miss;

  const target = promotionTargetFor(input.agent, promotionGroupOf(input.lotteryType));
  if (!target) return miss;
  if (input.gross.lessThan(target.minGross)) return miss;
  return { rate: target.rate, baseRate, promotionApplied: true };
}

/** อัตราคอมสุดท้ายของงวด ดู commissionDecision เมื่อต้องการเหตุผลประกอบ */
export function effectiveCommissionRate(input: {
  agent: AgentCommissionPromotion;
  lotteryType: LotteryType;
  drawDay: string;
  gross: Prisma.Decimal;
}): Prisma.Decimal {
  return commissionDecision(input).rate;
}

/**
 * สถานะโปรโมชั่นเทียบกับวันนี้
 *
 * ENDING_SOON แยกจาก ACTIVE เพราะโปรโมชั่นที่หมดอายุเงียบ ๆ คือเรื่องที่
 * Owner มารู้ทีหลังจาก Agent ทักมาถามว่าทำไมค่าคอมลดลง
 */
export type PromotionState = "NONE" | "SCHEDULED" | "ACTIVE" | "ENDING_SOON" | "EXPIRED";

export type PromotionStatus = {
  state: PromotionState;
  startsOn: string | null;
  endsOn: string | null;
  /** จำนวนวันจากวันนี้ถึงวันสิ้นสุด 0 = หมดวันนี้ ติดลบ = หมดไปแล้ว */
  daysLeft: number | null;
  thai: PromotionTarget | null;
  lao: PromotionTarget | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** จำนวนวันระหว่างสองวันปฏิทินรูปแบบ YYYY-MM-DD นับแบบเที่ยงคืน UTC จึงไม่มีเศษชั่วโมง */
function daysBetween(fromDay: string, toDay: string): number {
  return Math.round((Date.parse(`${toDay}T00:00:00.000Z`) - Date.parse(`${fromDay}T00:00:00.000Z`)) / DAY_MS);
}

export function promotionStatus(
  agent: AgentCommissionPromotion,
  today: string,
  endingSoonDays = 7,
): PromotionStatus {
  const thai = promotionTargetFor(agent, "THAI");
  const lao = promotionTargetFor(agent, "LAO");
  const startsOn = agent.commissionPromotionStartsOn ? databaseDay(agent.commissionPromotionStartsOn) : null;
  const endsOn = agent.commissionPromotionEndsOn ? databaseDay(agent.commissionPromotionEndsOn) : null;
  if (!startsOn || !endsOn || (!thai && !lao)) {
    return { state: "NONE", startsOn, endsOn, daysLeft: null, thai, lao };
  }

  const daysLeft = daysBetween(today, endsOn);
  const state: PromotionState = today < startsOn
    ? "SCHEDULED"
    : daysLeft < 0
      ? "EXPIRED"
      : daysLeft <= endingSoonDays
        ? "ENDING_SOON"
        : "ACTIVE";
  return { state, startsOn, endsOn, daysLeft, thai, lao };
}

export const PROMOTION_STATE_LABEL: Record<PromotionState, string> = {
  NONE: "ไม่มีโปรโมชั่น",
  SCHEDULED: "รอเริ่ม",
  ACTIVE: "ใช้งานอยู่",
  ENDING_SOON: "ใกล้หมดอายุ",
  EXPIRED: "หมดอายุแล้ว",
};

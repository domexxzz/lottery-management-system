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

function databaseDay(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * เลือกอัตราคอมสุดท้ายของงวด
 *
 * โปรโมชั่นคิดจากยอดขายของ Agent ในงวดนั้น ไม่ใช่ยอดสะสมข้ามงวด เพื่อให้ Settlement
 * ปิดบัญชีและตรวจย้อนหลังได้แน่นอนตั้งแต่งวดจบ โดยไม่ต้องย้อนแก้ยอดงวดที่อนุมัติแล้ว
 */
export function effectiveCommissionRate(input: {
  agent: AgentCommissionPromotion;
  lotteryType: LotteryType;
  drawDay: string;
  gross: Prisma.Decimal;
}): Prisma.Decimal {
  const baseRate = commissionRateForLottery(input.agent, input.lotteryType);
  const {
    commissionPromotionStartsOn: startsOn,
    commissionPromotionEndsOn: endsOn,
    commissionPromotionThaiMinGross: thaiMinGross,
    commissionPromotionLaoMinGross: laoMinGross,
    commissionPromotionThaiRate: thaiRate,
    commissionPromotionLaoRate: laoRate,
  } = input.agent;

  if (!startsOn || !endsOn) return baseRate;
  if (input.drawDay < databaseDay(startsOn) || input.drawDay > databaseDay(endsOn)) return baseRate;
  const minGross = input.lotteryType === "THAI_GOVERNMENT" ? thaiMinGross : laoMinGross;
  const rate = input.lotteryType === "THAI_GOVERNMENT" ? thaiRate : laoRate;
  if (!minGross || !rate) return baseRate;
  if (input.gross.lessThan(minGross)) return baseRate;
  return rate;
}

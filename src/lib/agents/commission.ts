import type { LotteryType, Prisma } from "@prisma/client";

export type AgentCommissionRates = {
  commissionRate: Prisma.Decimal;
  laoCommissionRate: Prisma.Decimal;
};

/** เลือกอัตราคอมตามประเภทหวย โดยหวยลาวปกติและหวยลาวชุดใช้อัตราเดียวกัน */
export function commissionRateForLottery(
  agent: AgentCommissionRates,
  lotteryType: LotteryType,
): Prisma.Decimal {
  return lotteryType === "THAI_GOVERNMENT" ? agent.commissionRate : agent.laoCommissionRate;
}

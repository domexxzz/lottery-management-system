import type { LotteryType, Prisma } from "@prisma/client";
import { commissionOf, ZERO } from "@/lib/money";
import {
  commissionDecision,
  commissionRateForLottery,
  type AgentCommissionPromotion,
} from "./commission";

/**
 * ค่าคอมของงวดหนึ่ง พร้อมเหตุผลว่าอัตรานั้นมาจากไหน
 *
 * ทุกหน้าที่แสดงค่าคอมต้องผ่านตรงนี้ ไม่ใช่คูณเรตเองในหน้าตัวเอง
 * ก่อนหน้านี้หลายหน้าคูณด้วย commissionRateForLottery ซึ่งเป็นเรตปกติเสมอ
 * ทำให้งวดที่เข้าโปรโมชั่นแสดงค่าคอมต่ำกว่าที่ Agent จะได้จริง
 *
 * ลำดับความน่าเชื่อถือ
 *   1. Settlement ที่คำนวณแล้ว คือตัวเลขที่ผูกพันและตรวจย้อนหลังได้
 *   2. ถ้ายังไม่คำนวณ จึงประมาณจากกฎโปรโมชั่นเดียวกับที่ Settlement จะใช้
 */

export type SettlementCommissionFacts = {
  commission: Prisma.Decimal;
  commissionRateSnapshot: Prisma.Decimal;
  commissionBaseRateSnapshot: Prisma.Decimal | null;
  commissionPromotionApplied: boolean;
};

export type DrawCommission = {
  commission: Prisma.Decimal;
  /** อัตราที่ใช้จริงกับงวดนี้ */
  rate: Prisma.Decimal;
  /** อัตราปกติที่จะใช้ถ้าไม่มีโปรโมชั่น */
  baseRate: Prisma.Decimal;
  promotionApplied: boolean;
  /** true = ยังไม่ปิดบัญชี ตัวเลขเป็นประมาณการจากยอดขายปัจจุบัน */
  estimated: boolean;
};

export function drawCommission(input: {
  agent: AgentCommissionPromotion;
  lotteryType: LotteryType;
  drawDay: string;
  gross: Prisma.Decimal;
  payout?: Prisma.Decimal;
  settlement?: SettlementCommissionFacts | null;
}): DrawCommission {
  const settlement = input.settlement;
  if (settlement) {
    return {
      commission: settlement.commission,
      rate: settlement.commissionRateSnapshot,
      /*
       * แถวเก่าที่คำนวณก่อนระบบเก็บเรตปกติไว้ จะไม่มี baseRate ให้ใช้
       * ถอยไปใช้เรตปัจจุบันของ Agent ดีกว่าไม่แสดงอะไรเลย แต่ไม่ถือว่าเข้าโปรฯ
       * เพราะธงที่บันทึกไว้ตอนนั้นคือคำตอบที่ถูกต้องอยู่แล้ว
       */
      baseRate: settlement.commissionBaseRateSnapshot
        ?? commissionRateForLottery(input.agent, input.lotteryType),
      promotionApplied: settlement.commissionPromotionApplied,
      estimated: false,
    };
  }

  const decision = commissionDecision({
    agent: input.agent,
    lotteryType: input.lotteryType,
    drawDay: input.drawDay,
    gross: input.gross,
  });
  return {
    commission: commissionOf({
      gross: input.gross,
      payout: input.payout ?? ZERO,
      commissionRatePercent: decision.rate,
    }),
    rate: decision.rate,
    baseRate: decision.baseRate,
    promotionApplied: decision.promotionApplied,
    estimated: true,
  };
}

/** สรุปอัตราที่ถูกใช้จริงในหลายงวด สำหรับแสดงเป็นป้ายเดียว */
export type CommissionRateSummary = {
  baseRates: number[];
  promotionRates: number[];
  promotionDraws: number;
  estimated: boolean;
};

/**
 * รวมอัตราของหลายงวดเป็นรายการที่ไม่ซ้ำกัน
 *
 * ไม่คืนค่าเฉลี่ยถ่วงน้ำหนัก เพราะเป็นตัวเลขที่ไม่ตรงกับอัตราใดที่ตกลงไว้กับ Agent
 * ตั้งโปรโมชั่น 32% แล้วเห็น 31.97% คือสิ่งที่ทำให้คนไม่เชื่อตัวเลขทั้งหน้า
 */
export function summarizeCommissionRates(rows: DrawCommission[]): CommissionRateSummary {
  const baseRates = new Set<number>();
  const promotionRates = new Set<number>();
  let promotionDraws = 0;
  let estimated = false;
  for (const row of rows) {
    if (row.promotionApplied) {
      promotionRates.add(Number(row.rate));
      promotionDraws += 1;
    } else {
      baseRates.add(Number(row.rate));
    }
    if (row.estimated) estimated = true;
  }
  const sorted = (values: Set<number>) => [...values].sort((a, b) => a - b);
  return {
    baseRates: sorted(baseRates),
    promotionRates: sorted(promotionRates),
    promotionDraws,
    estimated,
  };
}

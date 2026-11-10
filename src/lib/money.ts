import { Prisma } from "@prisma/client";

/**
 * กฎการปัดเศษของทั้งระบบ — แหล่งความจริงเดียว
 *
 * ⚠️ ค่าทั้งหมดในไฟล์นี้เป็นค่าตั้งต้นที่ทีมพัฒนาเลือกไว้ ยังไม่ได้รับการยืนยัน
 *    จากฝ่ายการเงิน (LOT-31) เมื่อได้คำตอบจริงแล้วให้แก้ที่ไฟล์นี้จุดเดียว
 *    ไม่ต้องไล่แก้ตามที่ต่าง ๆ
 *
 * ค่าที่เลือกและเหตุผล
 *
 * 1. ทศนิยม 2 ตำแหน่ง — หน่วยเงินคือบาทและสตางค์
 *
 * 2. ปัดครึ่งขึ้น (ROUND_HALF_UP) — เป็นวิธีที่คนทั่วไปเข้าใจตรงกัน
 *    ถ้าฝ่ายการเงินใช้ปัดครึ่งคู่ (banker's rounding) ให้เปลี่ยนที่ ROUNDING
 *
 * 3. ปัดที่ระดับรายการ ไม่ใช่ปัดเฉพาะยอดรวม
 *    เหตุผล: ยอดจ่ายรายรายการคือตัวเลขที่พิมพ์ลงบิลและจ่ายจริงให้ลูกค้า
 *    ถ้าปัดเฉพาะยอดรวม ผลรวมของบรรทัดในบิลจะไม่เท่ากับยอดรวมท้ายบิล
 *    ซึ่งกลายเป็นข้อพิพาทกับ Agent ทันที
 *    ผลข้างเคียงที่ยอมรับ: ยอดรวมอาจต่างจากการปัดครั้งเดียวตอนท้ายเล็กน้อย
 *
 * 4. คอมมิชชันคิดจากยอดขายรวม (gross) ไม่ใช่ยอดหลังหักเงินรางวัล
 *    เหตุผล: Agent ควรได้ค่าตอบแทนตามยอดที่ขายได้ ไม่ผูกกับโชคของรอบนั้น
 *    ถ้าธุรกิจคิดจากยอดหลังหักรางวัล ให้เปลี่ยนที่ COMMISSION_BASE
 */

export const MONEY_DECIMALS = 2;
export const ROUNDING = Prisma.Decimal.ROUND_HALF_UP;

/** ฐานที่ใช้คำนวณคอมมิชชัน */
export const COMMISSION_BASE: "GROSS" | "GROSS_MINUS_PAYOUT" = "GROSS";

export const ZERO = new Prisma.Decimal(0);

/** ปัดเป็นหน่วยเงิน ใช้กับทุกค่าที่จะถูกบันทึกหรือแสดงเป็นเงิน */
export function toMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(MONEY_DECIMALS, ROUNDING);
}

/**
 * ยอดจ่ายของหนึ่งรายการ = เงินเดิมพัน × อัตราจ่ายที่ล็อกไว้ตอนยืนยันบิล
 *
 * ต้องรับ payoutRateSnapshot ไม่ใช่เรตปัจจุบัน เพื่อให้คำนวณซ้ำได้ผลเดิม
 */
export function itemPayout(stake: Prisma.Decimal, payoutRateSnapshot: Prisma.Decimal): Prisma.Decimal {
  return toMoney(stake.times(payoutRateSnapshot));
}

/**
 * อัตราจ่ายเลขอั้น โดยค่าเริ่มต้นเท่ากับครึ่งหนึ่งของอัตราปกติ
 * รหัส 5 และ 6 (2 ตัวบน/ล่าง) เป็นกติกาธุรกิจเฉพาะ: อัตราปกติ 75 อั้นแล้วจ่าย 38
 */
export function reducedPayoutRate(payoutRate: Prisma.Decimal, prizeTypeCode?: number): Prisma.Decimal {
  if (prizeTypeCode === 5 || prizeTypeCode === 6) return new Prisma.Decimal(38);
  return payoutRate.dividedBy(2).toDecimalPlaces(4, ROUNDING);
}

/** คอมมิชชันของ Agent ตามฐานที่กำหนดใน COMMISSION_BASE */
export function commissionOf(input: {
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commissionRatePercent: Prisma.Decimal;
}): Prisma.Decimal {
  const base =
    COMMISSION_BASE === "GROSS" ? input.gross : input.gross.minus(input.payout);

  // ฐานติดลบแปลว่าจ่ายรางวัลมากกว่ายอดขาย ไม่คิดคอมเป็นค่าติดลบ
  const safeBase = base.lessThan(ZERO) ? ZERO : base;
  return toMoney(safeBase.times(input.commissionRatePercent).dividedBy(100));
}

/**
 * ผลสุทธิของ Agent ในรอบหนึ่ง
 *
 * net เป็นบวก = ระบบได้เงิน · net เป็นลบ = ระบบต้องจ่ายออก
 */
export function netOf(input: {
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
}): Prisma.Decimal {
  return toMoney(input.gross.minus(input.payout).minus(input.commission));
}

/** รวมค่าเงินหลายตัวโดยไม่ปัดระหว่างทาง ค่าที่รับเข้ามาควรปัดมาแล้ว */
export function sumMoney(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return toMoney(values.reduce<Prisma.Decimal>((acc, v) => acc.plus(v), ZERO));
}

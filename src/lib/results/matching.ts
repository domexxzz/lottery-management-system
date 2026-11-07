import type { MatchRule } from "@prisma/client";

/**
 * ตัดสินว่ารายการในบิลถูกรางวัลหรือไม่ (LOT-13)
 *
 * เป็น pure function ล้วน ไม่แตะฐานข้อมูล เพื่อให้ทดสอบกฎได้ตรง ๆ
 *
 * ⚠️ กติกาที่รองรับตอนนี้มีสามแบบตาม MatchRule เท่านั้น
 *    ถ้าธุรกิจมีรางวัลที่ตัดสินด้วยกติกาอื่น (เช่น ถูกบางหลักแบบมีเงื่อนไข)
 *    ต้องเพิ่ม MatchRule ใหม่ ไม่ใช่ดัดกฎเดิมให้พอใช้ — ดู LOT-28
 */

export type MatchInput = {
  /** เลขที่ผู้ซื้อแทง */
  number: string;
  /** เลขที่ออกของรางวัลประเภทนั้นในรอบนั้น */
  resultValue: string;
  matchRule: MatchRule;
};

function sortedDigits(value: string): string {
  return [...value].sort().join("");
}

export function isWinning(input: MatchInput): boolean {
  const number = input.number.trim();
  const result = input.resultValue.trim();

  if (number === "" || result === "") return false;
  if (!/^\d+$/.test(number) || !/^\d+$/.test(result)) return false;

  switch (input.matchRule) {
    case "EXACT":
      return number === result;

    case "PERMUTATION":
      // ความยาวต้องเท่ากันก่อน ไม่งั้น "12" จะถูกมองว่าตรงกับ "21x" ไม่ได้
      return number.length === result.length && sortedDigits(number) === sortedDigits(result);

    case "CONTAINS_DIGIT":
      // รางวัลวิ่ง: เลขที่แทงต้องปรากฏอยู่ในผลที่ออก
      // ถูกกี่ครั้งก็นับเป็นถูกหนึ่งครั้ง ไม่คูณตามจำนวนที่พบ
      return result.includes(number);

    default: {
      // ถ้ามีการเพิ่ม MatchRule ใหม่แล้วลืมเขียนกรณีนี้ TypeScript จะฟ้องตรงนี้
      const exhaustive: never = input.matchRule;
      throw new Error(`ยังไม่รองรับ MatchRule: ${String(exhaustive)}`);
    }
  }
}

export function isWinningAny(input: Omit<MatchInput, "resultValue"> & { resultValues: string[] }): boolean {
  return input.resultValues.some((resultValue) => isWinning({
    number: input.number,
    matchRule: input.matchRule,
    resultValue,
  }));
}

/** รูปร่างของรางวัลหนึ่งประเภทเท่าที่กฎการตัดสินต้องรู้ */
export type PrizeShape = {
  /** จำนวนหลักของเลขที่ผู้ซื้อแทง */
  digits: number;
  /** จำนวนหลักของผลที่ประกาศ null = เท่ากับ digits */
  resultDigits: number | null;
  matchRule: MatchRule;
};

export const RESULT_DIGITS_NOT_SET =
  "รางวัลวิ่งยังไม่ได้ตั้งจำนวนหลักของผลรางวัล ตั้งค่าที่หน้า Rulebook ก่อนลงผล";

/**
 * ความยาวของผลรางวัลที่ต้องกรอกสำหรับรางวัลประเภทนั้น
 *
 * คืน null เมื่อรางวัลวิ่งยังไม่ได้ตั้ง resultDigits — กรณีนี้ลงผลไม่ได้
 * เพราะเดาแทนไม่ได้ว่าธุรกิจเทียบวิ่งบนกับเลข 3 หลักหรือ 6 หลัก
 */
export function expectedResultLength(shape: PrizeShape): number | null {
  if (shape.matchRule === "CONTAINS_DIGIT") return shape.resultDigits;
  return shape.resultDigits ?? shape.digits;
}

/**
 * ตรวจว่า digits, resultDigits และ matchRule ของรางวัลหนึ่งเข้ากันได้
 *
 * ใช้ตอนบันทึก Rulebook เพื่อไม่ให้ตั้งค่าที่ทำให้รางวัลนั้นไม่มีทางถูกได้เลย
 * เช่น EXACT ที่เลขแทง 2 หลักแต่ผล 3 หลัก จะเทียบไม่ตรงตลอดกาล
 */
export function validatePrizeShape(shape: PrizeShape): string | null {
  if (shape.matchRule === "CONTAINS_DIGIT") {
    if (shape.resultDigits === null) {
      return "รางวัลวิ่งต้องระบุจำนวนหลักของผลรางวัล เช่น วิ่งบนเทียบกับเลข 3 ตัวบนจึงเป็น 3";
    }
    if (shape.resultDigits < shape.digits) {
      return `จำนวนหลักของผลรางวัล (${shape.resultDigits}) ต้องไม่น้อยกว่าจำนวนหลักของเลขที่แทง (${shape.digits})`;
    }
    return null;
  }

  if (shape.resultDigits !== null && shape.resultDigits !== shape.digits) {
    return `รางวัลที่เทียบเลขตรงต้องมีจำนวนหลักของผลรางวัลเท่ากับเลขที่แทง (${shape.digits}) หรือเว้นว่าง`;
  }

  return null;
}

/**
 * ตรวจว่าค่าผลรางวัลที่กรอกเข้ามาใช้กับรางวัลประเภทนั้นได้หรือไม่
 *
 * ความยาวที่บังคับคือความยาวของ "ผลที่ประกาศ" ไม่ใช่ความยาวของเลขที่แทง
 * สองค่านี้ต่างกันสำหรับรางวัลวิ่ง เช่น วิ่งบนแทง 1 หลัก แต่ผลยาว 3 หลัก
 * ถ้าบังคับด้วย digits เหมือนเดิม กฎ "เลขที่แทงปรากฏในผล" จะใช้ไม่ได้เลย
 */
export function validateResultValue(input: PrizeShape & { value: string }): string | null {
  const value = input.value.trim();

  if (!/^\d+$/.test(value)) return "ผลรางวัลต้องเป็นตัวเลขเท่านั้น";

  const expected = expectedResultLength(input);
  if (expected === null) return RESULT_DIGITS_NOT_SET;

  if (value.length !== expected) {
    return `ผลรางวัลต้องยาว ${expected} หลัก (กรอกมา ${value.length} หลัก)`;
  }

  return null;
}

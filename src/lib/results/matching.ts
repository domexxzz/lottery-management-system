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

/**
 * ตรวจว่าค่าผลรางวัลที่กรอกเข้ามาใช้กับรางวัลประเภทนั้นได้หรือไม่
 *
 * EXACT และ PERMUTATION — ผลต้องยาวเท่ากับจำนวนหลักที่รับ
 * CONTAINS_DIGIT — ผลคือเลขต้นทางที่เอามาหา เช่น วิ่งบนใช้เลข 3 ตัวบน
 *                  จึงต้องยาวกว่าจำนวนหลักที่รับ
 */
export function validateResultValue(input: {
  value: string;
  digits: number;
  matchRule: MatchRule;
}): string | null {
  const value = input.value.trim();

  if (!/^\d+$/.test(value)) return "ผลรางวัลต้องเป็นตัวเลขเท่านั้น";

  if (input.matchRule === "CONTAINS_DIGIT") {
    if (value.length <= input.digits) {
      return `รางวัลแบบวิ่งต้องกรอกเลขต้นทางที่ยาวกว่า ${input.digits} หลัก เช่นเลข 3 ตัวบน`;
    }
    return null;
  }

  if (value.length !== input.digits) {
    return `ผลรางวัลต้องยาว ${input.digits} หลัก (กรอกมา ${value.length} หลัก)`;
  }

  return null;
}

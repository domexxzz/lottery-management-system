import { describe, expect, test } from "vitest";
import {
  expectedResultLength,
  isWinning,
  validatePrizeShape,
  validateResultValue,
} from "./matching";

const win = (number: string, resultValue: string, matchRule: "EXACT" | "PERMUTATION" | "CONTAINS_DIGIT") =>
  isWinning({ number, resultValue, matchRule });

describe("EXACT — เลขตรงกันทุกหลัก", () => {
  test("ตรงกันถือว่าถูก", () => {
    expect(win("123", "123", "EXACT")).toBe(true);
  });

  test("สลับตำแหน่งไม่ถือว่าถูก", () => {
    expect(win("321", "123", "EXACT")).toBe(false);
  });

  test("เลขศูนย์นำหน้าต้องตรงตามตัวอักษร", () => {
    expect(win("007", "007", "EXACT")).toBe(true);
    expect(win("7", "007", "EXACT")).toBe(false);
    expect(win("070", "007", "EXACT")).toBe(false);
  });

  test("ความยาวต่างกันไม่ถูก", () => {
    expect(win("12", "123", "EXACT")).toBe(false);
  });
});

describe("PERMUTATION — โต๊ด", () => {
  test("สลับตำแหน่งถือว่าถูก", () => {
    expect(win("321", "123", "PERMUTATION")).toBe(true);
    expect(win("213", "123", "PERMUTATION")).toBe(true);
    expect(win("132", "123", "PERMUTATION")).toBe(true);
  });

  test("ตรงกันพอดีก็ถูก", () => {
    expect(win("123", "123", "PERMUTATION")).toBe(true);
  });

  test("เลขคนละชุดไม่ถูก", () => {
    expect(win("124", "123", "PERMUTATION")).toBe(false);
  });

  test("เลขซ้ำต้องนับจำนวนให้ตรงกัน", () => {
    expect(win("112", "121", "PERMUTATION")).toBe(true);
    // 122 กับ 112 มีตัวเลขคนละชุด แม้จะใช้ตัวเลขกลุ่มเดียวกัน
    expect(win("122", "112", "PERMUTATION")).toBe(false);
  });

  test("ความยาวต่างกันไม่ถูก แม้ตัวเลขจะเป็นชุดย่อย", () => {
    expect(win("12", "123", "PERMUTATION")).toBe(false);
    expect(win("21", "123", "PERMUTATION")).toBe(false);
  });

  test("โต๊ดสองหลัก", () => {
    expect(win("21", "12", "PERMUTATION")).toBe(true);
    expect(win("13", "12", "PERMUTATION")).toBe(false);
  });
});

describe("CONTAINS_DIGIT — รางวัลวิ่ง", () => {
  test("เลขที่แทงอยู่ในผลถือว่าถูก", () => {
    expect(win("1", "123", "CONTAINS_DIGIT")).toBe(true);
    expect(win("2", "123", "CONTAINS_DIGIT")).toBe(true);
    expect(win("3", "123", "CONTAINS_DIGIT")).toBe(true);
  });

  test("เลขที่ไม่อยู่ในผลไม่ถูก", () => {
    expect(win("4", "123", "CONTAINS_DIGIT")).toBe(false);
  });

  test("ปรากฏหลายครั้งยังนับเป็นถูกครั้งเดียว", () => {
    // ฟังก์ชันคืนค่า boolean จึงไม่คูณยอดจ่ายตามจำนวนที่พบ
    expect(win("1", "111", "CONTAINS_DIGIT")).toBe(true);
  });

  test("เลขศูนย์ทำงานถูกต้อง", () => {
    expect(win("0", "102", "CONTAINS_DIGIT")).toBe(true);
    expect(win("0", "123", "CONTAINS_DIGIT")).toBe(false);
  });
});

describe("ข้อมูลไม่ถูกต้อง", () => {
  test("ค่าว่างไม่ถูกรางวัล", () => {
    expect(win("", "123", "EXACT")).toBe(false);
    expect(win("123", "", "EXACT")).toBe(false);
  });

  test("ค่าที่ไม่ใช่ตัวเลขไม่ถูกรางวัล", () => {
    expect(win("12a", "12a", "EXACT")).toBe(false);
  });
});

describe("validateResultValue", () => {
  test("EXACT ต้องยาวเท่าจำนวนหลัก", () => {
    expect(
      validateResultValue({ value: "123", digits: 3, resultDigits: null, matchRule: "EXACT" }),
    ).toBeNull();
    expect(
      validateResultValue({ value: "12", digits: 3, resultDigits: null, matchRule: "EXACT" }),
    ).toContain("3 หลัก");
  });

  test("PERMUTATION ต้องยาวเท่าจำนวนหลัก", () => {
    expect(
      validateResultValue({
        value: "123",
        digits: 3,
        resultDigits: null,
        matchRule: "PERMUTATION",
      }),
    ).toBeNull();
    expect(
      validateResultValue({
        value: "1234",
        digits: 3,
        resultDigits: null,
        matchRule: "PERMUTATION",
      }),
    ).not.toBeNull();
  });

  test("ปฏิเสธค่าที่ไม่ใช่ตัวเลข", () => {
    expect(
      validateResultValue({ value: "12x", digits: 3, resultDigits: null, matchRule: "EXACT" }),
    ).toContain("ตัวเลข");
  });
});

/**
 * รางวัลวิ่งเคยใช้งานจริงไม่ได้ เพราะด่านตรวจผลบังคับความยาวด้วย digits
 * ซึ่งเป็นความยาวของเลขที่แทง ทำให้ผลของวิ่งบนกรอกได้แค่หลักเดียว
 * แล้วกฎ "เลขที่แทงปรากฏในผล" เสื่อมเป็นการเทียบเท่ากันทุกหลัก
 * ชุดนี้ล็อกพฤติกรรมที่ถูกต้องไว้ ไม่ให้ย้อนกลับไปเป็นอย่างเดิม
 */
describe("รางวัลวิ่ง — ความยาวของผลต่างจากความยาวของเลขที่แทง", () => {
  const วิ่งบน = { digits: 1, resultDigits: 3, matchRule: "CONTAINS_DIGIT" } as const;
  const วิ่งล่าง = { digits: 1, resultDigits: 2, matchRule: "CONTAINS_DIGIT" } as const;

  test("วิ่งบนรับผล 3 หลักตามเลข 3 ตัวบน", () => {
    expect(validateResultValue({ ...วิ่งบน, value: "123" })).toBeNull();
  });

  test("วิ่งบนปฏิเสธผลที่ยาวไม่ตรง", () => {
    expect(validateResultValue({ ...วิ่งบน, value: "1" })).toContain("3 หลัก");
    expect(validateResultValue({ ...วิ่งบน, value: "1234" })).toContain("3 หลัก");
  });

  test("วิ่งล่างรับผล 2 หลักตามเลข 2 ตัวล่าง", () => {
    expect(validateResultValue({ ...วิ่งล่าง, value: "57" })).toBeNull();
    expect(validateResultValue({ ...วิ่งล่าง, value: "123" })).toContain("2 หลัก");
  });

  test("ทุกหลักของผลที่ประกาศถูกรางวัล ไม่ใช่แค่หลักเดียว", () => {
    // นี่คือสิ่งที่บั๊กเดิมทำให้เป็นไปไม่ได้: กรอกผลได้หลักเดียว
    // คนแทงอีกสองหลักจึงถูกตัดเป็นไม่ถูกรางวัลทั้งที่ควรได้
    for (const bet of ["1", "2", "3"]) {
      expect(isWinning({ number: bet, resultValue: "123", matchRule: "CONTAINS_DIGIT" })).toBe(true);
    }
    expect(isWinning({ number: "4", resultValue: "123", matchRule: "CONTAINS_DIGIT" })).toBe(false);
  });

  test("รางวัลวิ่งที่ยังไม่ตั้ง resultDigits ลงผลไม่ได้ ไม่เดาค่าให้", () => {
    const ยังไม่ตั้งค่า = { digits: 1, resultDigits: null, matchRule: "CONTAINS_DIGIT" } as const;
    expect(expectedResultLength(ยังไม่ตั้งค่า)).toBeNull();
    expect(validateResultValue({ ...ยังไม่ตั้งค่า, value: "123" })).toContain("Rulebook");
    expect(validateResultValue({ ...ยังไม่ตั้งค่า, value: "1" })).toContain("Rulebook");
  });
});

describe("expectedResultLength", () => {
  test("ไม่ตั้ง resultDigits ใช้ digits แทนสำหรับรางวัลที่เทียบเลขตรง", () => {
    expect(expectedResultLength({ digits: 3, resultDigits: null, matchRule: "EXACT" })).toBe(3);
    expect(expectedResultLength({ digits: 2, resultDigits: null, matchRule: "PERMUTATION" })).toBe(2);
  });

  test("ตั้ง resultDigits แล้วใช้ค่านั้น", () => {
    expect(expectedResultLength({ digits: 1, resultDigits: 3, matchRule: "CONTAINS_DIGIT" })).toBe(3);
  });
});

describe("validatePrizeShape — กันการตั้งค่าที่ทำให้รางวัลไม่มีทางถูก", () => {
  test("รางวัลวิ่งต้องระบุจำนวนหลักของผล", () => {
    expect(
      validatePrizeShape({ digits: 1, resultDigits: null, matchRule: "CONTAINS_DIGIT" }),
    ).toContain("ต้องระบุ");
  });

  test("ผลของรางวัลวิ่งต้องไม่สั้นกว่าเลขที่แทง", () => {
    expect(
      validatePrizeShape({ digits: 3, resultDigits: 2, matchRule: "CONTAINS_DIGIT" }),
    ).not.toBeNull();
    expect(
      validatePrizeShape({ digits: 1, resultDigits: 3, matchRule: "CONTAINS_DIGIT" }),
    ).toBeNull();
  });

  test("รางวัลที่เทียบเลขตรงห้ามตั้งผลยาวไม่เท่าเลขที่แทง", () => {
    // ถ้ายอมให้ตั้ง เลขที่แทง 2 หลักจะเทียบกับผล 3 หลักไม่ตรงตลอดกาล
    expect(validatePrizeShape({ digits: 2, resultDigits: 3, matchRule: "EXACT" })).not.toBeNull();
    expect(validatePrizeShape({ digits: 2, resultDigits: 2, matchRule: "EXACT" })).toBeNull();
    expect(validatePrizeShape({ digits: 2, resultDigits: null, matchRule: "EXACT" })).toBeNull();
  });
});

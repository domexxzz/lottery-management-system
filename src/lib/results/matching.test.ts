import { describe, expect, test } from "vitest";
import { isWinning, validateResultValue } from "./matching";

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
    expect(validateResultValue({ value: "123", digits: 3, matchRule: "EXACT" })).toBeNull();
    expect(validateResultValue({ value: "12", digits: 3, matchRule: "EXACT" })).toContain("3 หลัก");
  });

  test("PERMUTATION ต้องยาวเท่าจำนวนหลัก", () => {
    expect(validateResultValue({ value: "123", digits: 3, matchRule: "PERMUTATION" })).toBeNull();
    expect(validateResultValue({ value: "1234", digits: 3, matchRule: "PERMUTATION" })).not.toBeNull();
  });

  test("CONTAINS_DIGIT ต้องกรอกเลขต้นทางที่ยาวกว่าจำนวนหลัก", () => {
    expect(validateResultValue({ value: "123", digits: 1, matchRule: "CONTAINS_DIGIT" })).toBeNull();
    expect(validateResultValue({ value: "1", digits: 1, matchRule: "CONTAINS_DIGIT" })).not.toBeNull();
  });

  test("ปฏิเสธค่าที่ไม่ใช่ตัวเลข", () => {
    expect(validateResultValue({ value: "12x", digits: 3, matchRule: "EXACT" })).toContain(
      "ตัวเลข",
    );
  });
});

import { describe, expect, test } from "vitest";
import { calculateComparison, comparisonChange, comparisonNarrative, type CompareRow, type ComparisonRule } from "./CompareTable";

const row = (current: number, previous: number, rule: ComparisonRule, overrides: Partial<CompareRow> = {}): CompareRow => ({
  label: "ทดสอบ", current, previous, rule, unit: "บาท", ...overrides,
});

describe("ชั้นคำนวณส่วนต่าง", () => {
  test("คำนวณ B - A และใช้ A เป็นฐานเปอร์เซ็นต์", () => {
    expect(calculateComparison(15_480, 870)).toEqual({ diff: -14_610, direction: "down", state: "changed", percent: -94.4 });
  });

  test("A เป็นศูนย์ต้องไม่คำนวณเปอร์เซ็นต์", () => {
    expect(calculateComparison(0, 3)).toEqual({ diff: 3, direction: "up", state: "started", percent: null });
  });

  test("B เป็นศูนย์ต้องลดลง 100 เปอร์เซ็นต์", () => {
    expect(calculateComparison(100, 0)).toEqual({ diff: -100, direction: "down", state: "stopped", percent: -100 });
  });
});

describe("ชั้นตีความผลกระทบทางธุรกิจ", () => {
  test("กำไรพลิกเป็นขาดทุนต้องแย่ลงตามผลต่างจริง", () => {
    expect(comparisonChange(row(10_836, -155_873.60, "profit", { signedWord: true }))).toMatchObject({
      direction: "down", tone: "is-bad", word: "พลิกจากกำไรเป็นขาดทุน", amount: "166,709.60", percent: "",
    });
  });

  test("ขาดทุนพลิกเป็นกำไรต้องเป็นผลดี", () => {
    expect(comparisonChange(row(-50_000, 10_000, "profit", { signedWord: true }))).toMatchObject({
      direction: "up", tone: "is-good", word: "พลิกจากขาดทุนเป็นกำไร", amount: "60,000.00", percent: "",
    });
  });

  test("ยอดขายลดลงต้องเป็นสีแดง", () => {
    expect(comparisonChange(row(15_480, 870, "revenue"))).toMatchObject({ direction: "down", tone: "is-bad", word: "ลดลง", percent: "−94.4%" });
  });

  test("จำนวนบิลเป็นข้อมูลทั่วไปแม้ลดลง", () => {
    expect(comparisonChange(row(6, 3, "neutral", { kind: "count", unit: "บิล" }))).toMatchObject({ direction: "down", tone: "is-neutral", word: "ลดลง", amount: "3 บิล", percent: "−50.0%" });
  });

  test("จ่ายรางวัลเพิ่มเป็นค่าใช้จ่ายและเป็นผลเสีย", () => {
    expect(comparisonChange(row(0, 156_500, "expense"))).toMatchObject({ direction: "up", tone: "is-bad", word: "มีค่าใช้จ่ายเพิ่ม", amount: "156,500.00 บาท", percent: "" });
  });

  test("ค่าคอมลดลงเป็นลูกศรลงแต่สีเขียว", () => {
    expect(comparisonChange(row(4_644, 243.60, "expense"))).toMatchObject({ direction: "down", tone: "is-good", word: "ค่าใช้จ่ายลดลง", amount: "4,400.40 บาท", percent: "−94.8%" });
  });

  test("เริ่มมีผู้ถูกรางวัลเป็นข้อมูลทั่วไปและไม่แสดงเปอร์เซ็นต์", () => {
    expect(comparisonChange(row(0, 3, "winners", { kind: "count", unit: "คน" }))).toMatchObject({
      direction: "up", tone: "is-neutral", word: "เพิ่มขึ้น", amount: "3 คน", detail: "(เริ่มมีผู้ถูกรางวัล)", percent: "",
    });
  });

  test("ศูนย์ทั้งสองฝั่งคือไม่มีการเปลี่ยนแปลง", () => {
    expect(comparisonChange(row(0, 0, "neutral"))).toMatchObject({ direction: "same", word: "ไม่มีการเปลี่ยนแปลง", tone: "is-neutral", percent: "" });
  });

  test("สร้างสรุปภาษาคนใต้ตารางและไม่ตัดสินข้อมูลทั่วไป", () => {
    const narrative = comparisonNarrative([
      row(10_836, -155_873.60, "profit", { label: "กำไร / ขาดทุน", signedWord: true }),
      row(15_480, 870, "revenue", { label: "ยอดขาย" }),
      row(6, 3, "neutral", { label: "จำนวนบิล", kind: "count", unit: "บิล" }),
    ]);
    expect(narrative[0]).toMatchObject({ tone: "is-bad" });
    expect(narrative[0]?.text).toContain("ผลประกอบการแย่ลง");
    expect(narrative[0]?.text).toContain("พลิกจากกำไรเป็นขาดทุน 166,709.60 บาท");
    expect(narrative[1]?.text).toContain("ยอดขายลดลง 14,610.00 บาท (−94.4%)");
    expect(narrative[2]).toMatchObject({ tone: "is-neutral" });
    expect(narrative[2]?.text).toContain("ไม่ได้หมายความว่าผลประกอบการดีขึ้นหรือแย่ลงโดยตรง");
  });
});

import { describe, expect, test } from "vitest";
import { isLaoDrawDay, laoBreakdown, laoResultForCode, laoResultProblem, LAO_DEFAULT_TIMES, LAO_PRIZE_TYPES, LAO_SET_ACTIVE_CODES } from "./rules";
import { permutations } from "@/lib/bills/betting";
import { isWinning } from "@/lib/results/matching";

describe("แยกผลหวยลาว (ใช้ 4 ตัวท้ายเสมอ)", () => {
  test("ตัวอย่างจากกติกา 651234", () => {
    expect(laoBreakdown("651234")).toEqual({ last4: "1234", last3: "234", first3: "123", last2: "34", first2: "12" });
  });

  test("ผลงวด 17 พ.ย. 2569: 489441 และผล 4–5 หลักใช้ 4 ตัวท้ายเหมือนกัน", () => {
    for (const raw of ["489441", "89441", "9441"]) {
      expect(laoBreakdown(raw)).toEqual({ last4: "9441", last3: "441", first3: "944", last2: "41", first2: "94" });
    }
  });

  test("ผลของแต่ละรหัสรางวัล", () => {
    const values = Object.fromEntries(LAO_PRIZE_TYPES.map((prize) => [prize.code, laoResultForCode(prize.code, "651234")]));
    expect(values).toEqual({ 101: "234", 102: "234", 103: "34", 104: "12", 201: "1234", 202: "234", 203: "1234", 204: "234", 205: "123", 206: "12", 207: "34" });
    expect(laoResultForCode(1, "651234")).toBeNull();
  });

  test("หวยลาวชุดเปิดรับเฉพาะ 4 ตัวตรงและ 4 ตัวโต๊ด", () => {
    expect(LAO_SET_ACTIVE_CODES).toEqual([201, 203]);
    expect(LAO_PRIZE_TYPES.filter((prize) => prize.lotteryType === "LAO_SET" && prize.isActive).map((prize) => prize.code)).toEqual([201, 203]);
  });

  test("ตรวจรูปแบบผล", () => {
    expect(laoResultProblem("489441")).toBeNull();
    expect(laoResultProblem("123")).toMatch(/4 ถึง 6/);
    expect(laoResultProblem("1234567")).toMatch(/4 ถึง 6/);
    expect(laoResultProblem("12a4")).toMatch(/ตัวเลข/);
  });
});

describe("โต๊ดสลับหลักเอง ตัดแบบที่ซ้ำ", () => {
  test("เลขไม่ซ้ำ 4 ตัว 24 แบบ 3 ตัว 6 แบบ", () => {
    expect(permutations("1234")).toHaveLength(24);
    expect(permutations("234")).toHaveLength(6);
  });

  test("เลขมีหลักซ้ำ: 9441 ได้ 12 แบบ 441 ได้ 3 แบบ", () => {
    expect(permutations("9441")).toHaveLength(12);
    expect(permutations("441").sort()).toEqual(["144", "414", "441"]);
  });

  test("ทุกแบบที่สลับถูกโต๊ด แต่เลขที่หลักไม่ครบชุดไม่ถูก", () => {
    for (const number of permutations("9441")) expect(isWinning({ number, resultValue: "9441", matchRule: "PERMUTATION" })).toBe(true);
    expect(isWinning({ number: "9411", resultValue: "9441", matchRule: "PERMUTATION" })).toBe(false);
  });
});

describe("วันออกหวยลาว", () => {
  test("ค่าเริ่มต้นรับบิลถึง 20:30 น.", () => {
    expect(LAO_DEFAULT_TIMES.cutoff).toBe("20:30");
  });

  test("จันทร์–ศุกร์เท่านั้น", () => {
    expect(isLaoDrawDay("2026-11-16")).toBe(true); // จันทร์
    expect(isLaoDrawDay("2026-11-20")).toBe(true); // ศุกร์
    expect(isLaoDrawDay("2026-11-21")).toBe(false); // เสาร์
    expect(isLaoDrawDay("2026-11-22")).toBe(false); // อาทิตย์
    expect(isLaoDrawDay("2026-02-30")).toBe(false);
  });
});

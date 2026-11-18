import { describe, expect, test } from "vitest";
import { isLaoDrawDay, laoBreakdown, laoResultForCode, laoResultProblem, laoSetMatchedPrizes, laoSetPackageLabel, laoSetPackagePrice, laoSetWinningPrize, LAO_DEFAULT_TIMES, LAO_PRIZE_TYPES, LAO_SET_ACTIVE_CODES, LAO_SET_PACKAGE_PAYOUTS } from "./rules";
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

  test("หวยลาวชุดเปิดรับเป็นเลขชุด 4 หลักเพียงประเภทเดียว", () => {
    expect(LAO_SET_ACTIVE_CODES).toEqual([201]);
    expect(LAO_PRIZE_TYPES.filter((prize) => prize.lotteryType === "LAO_SET" && prize.isActive).map((prize) => prize.code)).toEqual([201]);
  });

  test("ราคา 30/60/120 แยกเป็นประเภทย่อยของหวยลาวชุด", () => {
    expect([30, 60, 120].map(laoSetPackagePrice)).toEqual([30, 60, 120]);
    expect([30, 60, 120].map(laoSetPackageLabel)).toEqual(["ชุด 30 บาท", "ชุด 60 บาท", "ชุด 120 บาท"]);
    expect(laoSetPackagePrice(50)).toBeNull();
    expect(laoSetPackageLabel("50.00")).toBeNull();
  });

  test("เลขชุดหนึ่งรายการลุ้น 8 รางวัล และคืนเฉพาะรางวัลที่สูงที่สุด", () => {
    expect(laoSetWinningPrize("1234", "651234", 30)).toMatchObject({ key: "EXACT_4", payout: 25_500 });
    expect(laoSetWinningPrize("1234", "654321", 30)).toMatchObject({ key: "PERMUTATION_4", payout: 1_125 });
    expect(laoSetWinningPrize("1234", "659234", 30)).toMatchObject({ key: "LAST_3_EXACT", payout: 9_250 });
    expect(laoSetWinningPrize("1234", "659243", 30)).toMatchObject({ key: "LAST_3_PERMUTATION", payout: 925 });
    expect(laoSetWinningPrize("1234", "651239", 30)).toMatchObject({ key: "FIRST_3_EXACT", payout: 1_425 });
    expect(laoSetWinningPrize("1234", "652139", 30)).toMatchObject({ key: "FIRST_3_PERMUTATION", payout: 425 });
    expect(laoSetWinningPrize("1234", "651299", 30)).toMatchObject({ key: "FIRST_2", payout: 350 });
    expect(laoSetWinningPrize("1234", "659934", 30)).toMatchObject({ key: "LAST_2", payout: 350 });
    expect(laoSetWinningPrize("1234", "659999", 30)).toBeNull();
  });

  test("ตัวอย่าง 1234 / ผล 561234 เข้าเงื่อนไขครบ 8 รางวัล แต่เลือกจ่าย 4 ตัวตรงครั้งเดียว", () => {
    expect(laoBreakdown("561234")).toEqual({ last4: "1234", last3: "234", first3: "123", last2: "34", first2: "12" });
    expect(laoSetMatchedPrizes("1234", "561234", 30).map((prize) => prize.key)).toEqual([
      "EXACT_4",
      "PERMUTATION_4",
      "LAST_3_EXACT",
      "LAST_3_PERMUTATION",
      "FIRST_3_EXACT",
      "FIRST_3_PERMUTATION",
      "FIRST_2",
      "LAST_2",
    ]);
    expect(laoSetWinningPrize("1234", "561234", 30)).toEqual({ key: "EXACT_4", label: "4 ตัวตรง", payout: 25_500 });
  });

  test("อัตราจ่ายครบทั้งชุด 30/60/120 ตามตาราง", () => {
    expect(LAO_SET_PACKAGE_PAYOUTS).toEqual([
      { price: 30, exact: 25_500, permutation: 1_125, last3Exact: 9_250, last3Permutation: 925, first3Exact: 1_425, first3Permutation: 425, first2: 350, last2: 350 },
      { price: 60, exact: 51_000, permutation: 2_250, last3Exact: 18_500, last3Permutation: 1_850, first3Exact: 2_850, first3Permutation: 850, first2: 700, last2: 700 },
      { price: 120, exact: 102_000, permutation: 4_500, last3Exact: 37_000, last3Permutation: 3_700, first3Exact: 5_700, first3Permutation: 1_700, first2: 1_400, last2: 1_400 },
    ]);
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

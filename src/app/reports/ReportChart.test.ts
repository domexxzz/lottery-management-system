import { describe, expect, test } from "vitest";
import { correlation, statistics } from "./ReportChart";

describe("advanced report statistics", () => {
  test("คำนวณ quartile, median และ sample standard deviation ถูกต้อง", () => {
    const result = statistics([5, 1, 4, 2, 3]);

    expect(result.count).toBe(5);
    expect(result.mean).toBe(3);
    expect(result.median).toBe(3);
    expect(result.q1).toBe(2);
    expect(result.q3).toBe(4);
    expect(result.deviation).toBeCloseTo(Math.sqrt(2.5));
  });

  test("คำนวณ Pearson correlation และ linear regression ถูกต้อง", () => {
    const result = correlation([1, 2, 3, 4], [2, 4, 6, 8]);

    expect(result.r).toBeCloseTo(1);
    expect(result.slope).toBeCloseTo(2);
    expect(result.intercept).toBeCloseTo(0);
  });

  test("ข้อมูลคงที่ไม่สร้าง NaN หรือ Infinity", () => {
    const result = correlation([10, 10, 10], [1, 2, 3]);

    expect(result.r).toBe(0);
    expect(result.slope).toBe(0);
    expect(Number.isFinite(result.intercept)).toBe(true);
  });
});

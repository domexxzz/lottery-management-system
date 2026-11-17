import { describe, expect, test } from "vitest";
import { accountingHref, parseAccountingQuery, resolveRange } from "./accounting-period";

const NOW = new Date("2026-11-18T05:00:00Z"); // 18 พ.ย. 2569 เวลาไทย

describe("ช่วงเวลาของสรุปบัญชี", () => {
  test("ค่าเริ่มต้นคือรายเดือนของเดือนนี้", () => {
    const query = parseAccountingQuery({}, NOW);
    expect(query).toMatchObject({ period: "month", month: "2026-11", year: "2026", lottery: "", agentId: "" });
    expect(resolveRange(query, NOW)).toMatchObject({ from: "2026-11-01", to: "2026-11-30" });
  });

  test("3 เดือน 6 เดือน นับรวมเดือนนี้", () => {
    expect(resolveRange(parseAccountingQuery({ period: "3m" }, NOW), NOW)).toMatchObject({ from: "2026-09-01", to: "2026-11-30" });
    expect(resolveRange(parseAccountingQuery({ period: "6m" }, NOW), NOW)).toMatchObject({ from: "2026-06-01", to: "2026-11-30" });
  });

  test("รายปีและกำหนดเอง", () => {
    expect(resolveRange(parseAccountingQuery({ period: "year", year: "2025" }, NOW), NOW)).toMatchObject({ from: "2025-01-01", to: "2025-12-31", label: "ปี 2568" });
    expect(resolveRange(parseAccountingQuery({ period: "custom", from: "2026-10-05", to: "2026-10-20" }, NOW), NOW)).toMatchObject({ from: "2026-10-05", to: "2026-10-20" });
    // ถึงวันที่ก่อนตั้งแต่ ใช้วันนี้แทน
    expect(resolveRange(parseAccountingQuery({ period: "custom", from: "2026-10-05", to: "2026-09-01" }, NOW), NOW).to).toBe("2026-11-18");
  });

  test("เดือนกุมภาพันธ์และค่าแปลกในลิงก์", () => {
    expect(resolveRange(parseAccountingQuery({ period: "month", month: "2028-02" }, NOW), NOW).to).toBe("2028-02-29");
    expect(parseAccountingQuery({ period: "weird", month: "2026-13", lottery: "X" }, NOW)).toMatchObject({ period: "month", month: "2026-11", lottery: "" });
  });

  test("ลิงก์เก็บเฉพาะค่าที่ใช้กับช่วงที่เลือก", () => {
    const query = parseAccountingQuery({ period: "month", month: "2026-10", agentId: "a1", lottery: "LAO" }, NOW);
    expect(accountingHref("/reports/accounting", query, {})).toBe("/reports/accounting?period=month&month=2026-10&agentId=a1&lottery=LAO");
    expect(accountingHref("/reports/accounting", query, { period: "draw", drawId: "d1" })).toBe("/reports/accounting?period=draw&drawId=d1&agentId=a1&lottery=LAO");
  });
});

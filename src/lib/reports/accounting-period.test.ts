import { describe, expect, test } from "vitest";
import { accountingHref, parseAccountingQuery, resolveRange } from "./accounting-period";

const NOW = new Date("2026-11-18T05:00:00Z"); // พุธ 18 พ.ย. 2569 เวลาไทย

describe("ช่วงเวลาของสรุปบัญชี", () => {
  test("ค่าเริ่มต้นคืองวดนี้ เทียบงวดที่แล้ว และทุกประเภทหวย", () => {
    const query = parseAccountingQuery({}, NOW);
    expect(query).toMatchObject({
      period: "current_draw",
      compareA: "current_draw",
      compareB: "previous_draw",
      lotteries: ["THAI_GOVERNMENT", "LAO", "LAO_SET"],
      agentId: "",
    });
  });

  test("วันนี้ เมื่อวาน สัปดาห์นี้ และสัปดาห์ที่แล้วใช้วันไทยถูกต้อง", () => {
    expect(resolveRange(parseAccountingQuery({ period: "today" }, NOW), NOW)).toMatchObject({ from: "2026-11-18", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "yesterday" }, NOW), NOW)).toMatchObject({ from: "2026-11-17", to: "2026-11-17" });
    expect(resolveRange(parseAccountingQuery({ period: "this_week" }, NOW), NOW)).toMatchObject({ from: "2026-11-16", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "last_week" }, NOW), NOW)).toMatchObject({ from: "2026-11-09", to: "2026-11-15" });
  });

  test("เดือน 3 เดือน 6 เดือน ปีนี้ และปีที่แล้ว", () => {
    expect(resolveRange(parseAccountingQuery({ period: "current_month" }, NOW), NOW)).toMatchObject({ from: "2026-11-01", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "3m" }, NOW), NOW)).toMatchObject({ from: "2026-09-01", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "6m" }, NOW), NOW)).toMatchObject({ from: "2026-06-01", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "current_year" }, NOW), NOW)).toMatchObject({ from: "2026-01-01", to: "2026-11-18" });
    expect(resolveRange(parseAccountingQuery({ period: "previous_year" }, NOW), NOW)).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
  });

  test("ลิงก์เก็บช่วงเปรียบเทียบ ตัวกรอง Agent และหลายประเภทหวย", () => {
    const query = parseAccountingQuery({
      period: "this_week",
      agentId: "a1",
      lotteries: "THAI_GOVERNMENT,LAO",
      compareA: "today",
      compareB: "yesterday",
    }, NOW);
    expect(accountingHref("/reports/accounting", query, {})).toBe(
      "/reports/accounting?period=this_week&agentId=a1&lotteries=THAI_GOVERNMENT%2CLAO&compareA=today&compareB=yesterday",
    );
  });

  test("เลือกหลายประเภทได้ เรียงคงที่ รองรับลิงก์เดิม และเลือกศูนย์ประเภทได้", () => {
    expect(parseAccountingQuery({ lotteries: "LAO_SET,THAI_GOVERNMENT" }, NOW).lotteries).toEqual(["THAI_GOVERNMENT", "LAO_SET"]);
    expect(parseAccountingQuery({ lottery: "LAO" }, NOW).lotteries).toEqual(["LAO"]);
    expect(parseAccountingQuery({ period: "month" }, NOW).period).toBe("current_month");
    const none = parseAccountingQuery({ lotteries: "none" }, NOW);
    expect(none.lotteries).toEqual([]);
    expect(accountingHref("/reports/accounting", none, {})).toContain("lotteries=none");
  });
});

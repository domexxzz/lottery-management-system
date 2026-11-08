import { describe, expect, test } from "vitest";
import { addDays, addMonths, calendarDays, isDateDisabled, isDateInRange, parseISODate, parseISODateTime, todayInTimeZone, toISODate } from "./calendar.utils";

describe("calendar date integrity", () => {
  test("รองรับ leap year และปฏิเสธวันที่ไม่มีจริง", () => {
    expect(parseISODate("2024-02-29")).not.toBeNull();
    expect(parseISODate("2023-02-29")).toBeNull();
    expect(parseISODate("2026-11-31")).toBeNull();
  });

  test("ข้ามสิ้นเดือนและสิ้นปีโดยไม่เลื่อน timezone", () => {
    expect(toISODate(addDays(parseISODate("2026-12-31")!, 1))).toBe("2027-01-01");
    expect(toISODate(addMonths(parseISODate("2026-12-15")!, 1))).toBe("2027-01-01");
  });

  test("grid มี 42 วันและเริ่มวันอาทิตย์", () => {
    const days = calendarDays(parseISODate("2026-11-01")!);
    expect(days).toHaveLength(42);
    expect(days[0]?.getUTCDay()).toBe(0);
    expect(toISODate(days.at(-1)!)).toBe("2026-12-12");
  });

  test("min max disabled และช่วงวันที่ทำงานถูกต้อง", () => {
    expect(isDateDisabled("2026-11-07", "2026-11-08")).toBe(true);
    expect(isDateDisabled("2026-11-09", undefined, "2026-11-08")).toBe(true);
    expect(isDateDisabled("2026-11-08", undefined, undefined, (date) => date.endsWith("08"))).toBe(true);
    expect(isDateInRange("2026-11-09", "2026-11-08", "2026-11-10")).toBe(true);
    expect(isDateInRange("2026-11-08", "2026-11-08", "2026-11-10")).toBe(false);
  });

  test("datetime local คงวันและเวลาเดิม", () => {
    expect(parseISODateTime("2026-11-08T14:05")).toEqual({ date: "2026-11-08", time: "14:05" });
    expect(parseISODateTime("2026-11-08T24:00")).toBeNull();
  });

  test("วันนี้อิง timezone ที่กำหนด", () => {
    expect(todayInTimeZone("Asia/Bangkok", new Date("2026-11-08T18:30:00Z"))).toBe("2026-11-09");
  });
});


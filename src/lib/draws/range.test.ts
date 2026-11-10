import { describe, expect, test } from "vitest";
import { drawDay, inRange, monthShortcuts, parseDay, recentMonths, thaiDayLabel } from "./range";

describe("ช่วงวันที่ของงวด", () => {
  test("parseDay รับเฉพาะวันที่จริงรูปแบบ YYYY-MM-DD", () => {
    expect(parseDay("2026-12-01")).toBe("2026-12-01");
    expect(parseDay("2026-02-30")).toBeUndefined();
    expect(parseDay("1/12/2026")).toBeUndefined();
    expect(parseDay("")).toBeUndefined();
    expect(parseDay(null)).toBeUndefined();
  });

  test("drawDay ใช้ drawDate ก่อน ถ้าไม่มีใช้วันปิดรับตามเวลาไทย", () => {
    expect(drawDay({ drawDate: new Date("2026-12-16T00:00:00Z"), cutoffAt: new Date("2026-12-16T08:30:00Z") })).toBe("2026-12-16");
    // 20:00 UTC = 03:00 วันถัดไปตามเวลาไทย
    expect(drawDay({ drawDate: null, cutoffAt: new Date("2026-11-30T20:00:00Z") })).toBe("2026-12-01");
  });

  test("เลือก 1–31 ธ.ค. ได้ทั้งงวด 1 และ 16 ธ.ค. ไม่รวมเดือนอื่น", () => {
    const days = ["2026-11-16", "2026-12-01", "2026-12-16", "2027-01-02"];
    expect(days.filter((day) => inRange(day, "2026-12-01", "2026-12-31"))).toEqual(["2026-12-01", "2026-12-16"]);
    expect(days.filter((day) => inRange(day, "2026-12-10", undefined))).toEqual(["2026-12-16", "2027-01-02"]);
  });

  test("ปุ่มลัดรายเดือน ใหม่สุดก่อน ไม่ซ้ำ และวันสุดท้ายของเดือนถูกต้อง", () => {
    const shortcuts = monthShortcuts(["2026-12-01", "2026-12-16", "2027-02-01", "2026-11-16"]);
    expect(shortcuts.map((month) => month.key)).toEqual(["2027-02", "2026-12", "2026-11"]);
    expect(shortcuts[0]).toMatchObject({ label: "ก.พ. 70", from: "2027-02-01", to: "2027-02-28" });
    expect(shortcuts[1]).toMatchObject({ label: "ธ.ค. 69", name: "ธันวาคม 2569", from: "2026-12-01", to: "2026-12-31" });
  });

  test("thaiDayLabel", () => {
    expect(thaiDayLabel("2026-12-01")).toBe("1 ธ.ค. 69");
  });

  test("recentMonths นับเดือนตามเวลาไทยย้อนหลังจากเดือนปัจจุบัน และครอบคลุมทั้งเดือน", () => {
    // 31 ต.ค. 2026 18:00 UTC = 1 พ.ย. 2026 01:00 เวลาไทย
    const months = recentMonths(new Date("2026-10-31T18:00:00Z"), 3);
    expect(months.map((month) => month.key)).toEqual(["2026-11", "2026-10", "2026-09"]);
    expect(months[0]).toMatchObject({ name: "พฤศจิกายน 2569", from: "2026-11-01", to: "2026-11-30" });
    expect(recentMonths(new Date("2027-01-15T00:00:00Z"), 2).map((month) => month.to)).toEqual(["2027-01-31", "2026-12-31"]);
  });
});

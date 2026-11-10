import { describe, expect, test } from "vitest";
import { drawStage, drawWhereOf, oldestCurrentDrawDay, pickCurrentDraw, scopeOfDraw, timeLeftLabel } from "./draw-scope";
import { historyHref, parseHistoryFilter } from "./history-filter";

const at = (iso: string) => new Date(iso);

describe("ขอบเขตงวดของหน้าบิล", () => {
  // งวด 16 พ.ย. 2026 ปิดรับ 14:00 เวลาไทย (07:00Z)
  const draw16 = { drawDate: at("2026-11-16T00:00:00Z"), cutoffAt: at("2026-11-16T07:00:00Z") };

  test("งวดที่เปิดรับอยู่เป็นงวดปัจจุบัน", () => {
    expect(scopeOfDraw({ ...draw16, status: "OPEN" }, at("2026-11-10T04:00:00Z"))).toBe("current");
  });

  test("ปิดรับแล้วในวันออกรางวัลยังเป็นงวดปัจจุบัน และอยู่ต่ออีก 2 วัน", () => {
    for (const status of ["LOCKED", "RESULT_PENDING", "SETTLED", "CLOSED"] as const) {
      // 16 พ.ย. 15:00 เวลาไทย: ปิดรับแล้ว
      expect(scopeOfDraw({ ...draw16, status }, at("2026-11-16T08:00:00Z"))).toBe("current");
      // 17 พ.ย. 23:59 เวลาไทย: ยังเป็นงวดปัจจุบัน
      expect(scopeOfDraw({ ...draw16, status }, at("2026-11-17T16:59:00Z"))).toBe("current");
      // 18 พ.ย. 00:00 เวลาไทย: ผ่านไป 2 วัน ย้ายไปงวดย้อนหลัง
      expect(scopeOfDraw({ ...draw16, status }, at("2026-11-17T17:00:00Z"))).toBe("past");
    }
  });

  test("งวดวันที่ 1 ย้ายไปงวดย้อนหลังวันที่ 3", () => {
    const draw1 = { drawDate: at("2026-12-01T00:00:00Z"), cutoffAt: at("2026-12-01T07:00:00Z"), status: "SETTLED" as const };
    expect(scopeOfDraw(draw1, at("2026-12-02T10:00:00Z"))).toBe("current");
    expect(scopeOfDraw(draw1, at("2026-12-03T01:00:00Z"))).toBe("past");
  });

  test("งวดที่ไม่มี drawDate ใช้วันปิดรับตามเวลาไทย", () => {
    const draw = { drawDate: null, cutoffAt: at("2026-11-16T07:00:00Z"), status: "LOCKED" as const };
    expect(scopeOfDraw(draw, at("2026-11-17T10:00:00Z"))).toBe("current");
    expect(scopeOfDraw(draw, at("2026-11-18T01:00:00Z"))).toBe("past");
  });

  test("เงื่อนไขฐานข้อมูลใช้วันแรกที่ยังเป็นงวดปัจจุบันเดียวกัน", () => {
    const now = at("2026-11-17T10:00:00Z"); // 17 พ.ย. เวลาไทย → งวดตั้งแต่ 16 พ.ย. ยังเป็นปัจจุบัน
    expect(oldestCurrentDrawDay(now)).toBe("2026-11-16");
    expect(JSON.stringify(drawWhereOf("current", now))).toContain("2026-11-16T00:00:00.000Z");
    expect(JSON.stringify(drawWhereOf("past", now))).toContain("2026-11-15T17:00:00.000Z");
    expect(drawWhereOf("all", now)).toBeUndefined();
  });

  test("ค่าเริ่มต้นคืองวดปัจจุบันที่ปิดรับเร็วที่สุด: งวดที่เพิ่งออกก่อน แล้วจึงงวดถัดไป", () => {
    const draws = [
      { id: "next", status: "OPEN" as const, drawDate: at("2026-12-01T00:00:00Z"), cutoffAt: at("2026-12-01T07:00:00Z") },
      { id: "just-drawn", status: "SETTLED" as const, ...draw16 },
      { id: "stale", status: "LOCKED" as const, drawDate: at("2025-11-01T00:00:00Z"), cutoffAt: at("2025-11-01T08:00:00Z") },
    ];
    expect(pickCurrentDraw(draws, at("2026-11-17T10:00:00Z"))?.id).toBe("just-drawn");
    expect(pickCurrentDraw(draws, at("2026-11-18T10:00:00Z"))?.id).toBe("next");
    expect(pickCurrentDraw([draws[2]!], at("2026-11-18T10:00:00Z"))).toBeNull();
  });

  test("ป้ายขั้นตอนของงวด", () => {
    const draw = { opensAt: at("2026-11-02T00:00:00Z"), cutoffAt: at("2026-11-16T07:00:00Z") };
    expect(drawStage({ ...draw, status: "OPEN" }, at("2026-11-01T00:00:00Z")).label).toBe("ยังไม่เปิดรับ");
    expect(drawStage({ ...draw, status: "OPEN" }, at("2026-11-10T00:00:00Z")).tone).toBe("open");
    expect(drawStage({ ...draw, status: "OPEN" }, at("2026-11-16T08:00:00Z")).label).toBe("ถึงเวลาปิดรับ");
    expect(drawStage({ ...draw, status: "RESULT_PENDING" }, at("2026-11-16T08:00:00Z")).label).toBe("รอตรวจรางวัล");
    expect(drawStage({ ...draw, status: "CLOSED" }, at("2026-11-20T00:00:00Z")).tone).toBe("done");
  });

  test("เวลาที่เหลือก่อนปิดรับ", () => {
    const now = at("2026-11-10T04:00:00Z");
    expect(timeLeftLabel(at("2026-11-16T07:00:00Z"), now)).toBe("เหลือ 6 วัน 3 ชม.");
    expect(timeLeftLabel(at("2026-11-10T06:30:00Z"), now)).toBe("เหลือ 2 ชม. 30 นาที");
    expect(timeLeftLabel(at("2026-11-10T04:20:00Z"), now)).toBe("เหลือ 20 นาที");
    expect(timeLeftLabel(at("2026-11-10T03:00:00Z"), now)).toBeNull();
  });

  test("ขอบเขตใน URL: ค่าเริ่มต้นคืองวดปัจจุบันและไม่ใส่ลง URL", () => {
    expect(parseHistoryFilter({}).scope).toBe("current");
    expect(parseHistoryFilter({ scope: "past" }).scope).toBe("past");
    expect(parseHistoryFilter({ scope: "อื่น ๆ" }).scope).toBe("current");
    expect(historyHref("/bills", parseHistoryFilter({}))).toBe("/bills");
    expect(historyHref("/bills", parseHistoryFilter({ scope: "all", agent: "a1" }))).toBe("/bills?agent=a1&scope=all");
  });
});

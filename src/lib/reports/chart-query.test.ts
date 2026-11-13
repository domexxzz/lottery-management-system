import { describe, expect, it } from "vitest";
import { parseChartMatrixQuery } from "./chart-query";

describe("parseChartMatrixQuery", () => {
  it("ใช้ค่าเริ่มต้นที่จำกัด 24 งวด", () => {
    const result = parseChartMatrixQuery(new URLSearchParams());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.filters.drawLimit).toBe(24);
    expect(result.filters.rowLimit).toBe(5_000);
  });

  it("รองรับรายการซ้ำและ comma separated โดยไม่ส่งค่าซ้ำลง query", () => {
    const params = new URLSearchParams("drawIds=d1,d2&drawIds=d2&agentIds=a1,a2");
    const result = parseChartMatrixQuery(params);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.filters.drawIds).toEqual(["d1", "d2"]);
    expect(result.filters.agentIds).toEqual(["a1", "a2"]);
  });

  it("สร้างขอบเขตวันตาม Asia/Bangkok", () => {
    const result = parseChartMatrixQuery(new URLSearchParams("from=2026-11-01&to=2026-11-12"));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.filters.from?.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(result.filters.to?.toISOString()).toBe("2026-11-12T16:59:59.999Z");
  });

  it("ปฏิเสธช่วงวันที่กลับด้าน", () => {
    const result = parseChartMatrixQuery(new URLSearchParams("from=2026-11-12&to=2026-11-01"));
    expect(result).toEqual({ success: false, error: "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น" });
  });
});

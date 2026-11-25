import { describe, expect, test } from "vitest";
import { auditDateRange, auditDrawWhere } from "./history";

describe("ตัวกรองประวัติการตรวจผลรางวัล", () => {
  test("แปลงวันไทยเป็นขอบเขตเวลาและปฏิเสธวันที่ไม่ถูกต้อง", () => {
    const range = auditDateRange("2026-11-01", "2026-11-30");
    expect(range.from?.toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(range.to?.toISOString()).toBe("2026-11-30T16:59:59.999Z");
    expect(auditDateRange("2026-02-31", "bad")).toEqual({ fromDay: undefined, toDay: undefined, from: undefined, to: undefined });
  });

  test("แยกทุกงวดออกจากกรณีไม่มีงวดตรงประเภท", () => {
    expect(auditDrawWhere(undefined)).toEqual({});
    expect(auditDrawWhere([])).toEqual({ drawId: { in: [] } });
    expect(auditDrawWhere(["draw-1"])).toEqual({ drawId: { in: ["draw-1"] } });
  });
});

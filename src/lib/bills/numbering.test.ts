import { describe, expect, test } from "vitest";
import { billSequencePeriod, buildInternalBillNumber, publicBillCode, publicSlipCode, visibleBillNumber } from "./numbering";

describe("เลขบิล", () => {
  test("สร้างรหัสภายในจาก Agent ประเภท วันที่กรุงเทพ และลำดับ 4 หลัก", () => {
    expect(buildInternalBillNumber({
      agentCode: "A1",
      lotteryType: "THAI_GOVERNMENT",
      issuedAt: new Date("2026-10-11T08:00:00.000Z"),
      drawSequence: 1,
      drawId: "draw-1",
    })).toBe("A1011110260001-draw-1");
  });

  test("ตัวนับใช้คีย์แยกตามงวด", () => {
    expect(billSequencePeriod("draw-1")).toBe("draw:draw-1");
    expect(billSequencePeriod("draw-2")).toBe("draw:draw-2");
  });

  test("รหัสที่แสดงใช้ประเภท วัน เดือน ปี และเลขบิล", () => {
    const date = new Date("2026-11-25T00:00:00.000Z");
    const base = { drawDate: date, cutoffAt: date, drawSequence: 1 };
    expect(publicBillCode({ ...base, lotteryTypes: ["THAI_GOVERNMENT"] })).toBe("T25112601");
    expect(publicBillCode({ ...base, lotteryTypes: ["LAO", "LAO_SET"] })).toBe("L25112601");
    expect(publicBillCode({ ...base, lotteryTypes: ["THAI_GOVERNMENT", "LAO", "LAO_SET"] })).toBe("TL25112601");
    expect(publicBillCode({ ...base, drawSequence: 100, lotteryTypes: ["THAI_GOVERNMENT"] })).toBe("T251126100");
    expect(publicSlipCode(1, [
      { draw: { lotteryType: "LAO", drawDate: date, cutoffAt: date } },
      { draw: { lotteryType: "LAO_SET", drawDate: date, cutoffAt: date } },
    ])).toBe("L25112601");
    expect(publicSlipCode(1, [
      { draw: { lotteryType: "LAO", drawDate: date, cutoffAt: date } },
      { draw: { lotteryType: "THAI_GOVERNMENT", drawDate: date, cutoffAt: date } },
    ])).toBe("TL25112601");
  });

  test("แสดงเฉพาะเลขลำดับที่อ่านง่าย", () => {
    expect(visibleBillNumber(1)).toBe("บิล 1");
    expect(visibleBillNumber(null)).toBe("บิลร่าง");
  });
});

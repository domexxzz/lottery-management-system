import { describe, expect, test } from "vitest";
import { billSequencePeriod, buildInternalBillNumber, visibleBillNumber } from "./numbering";

describe("เลขบิล", () => {
  test("สร้างรหัสภายในจาก Agent ประเภท วันที่กรุงเทพ และลำดับ 4 หลัก", () => {
    expect(buildInternalBillNumber({
      agentCode: "A1",
      lotteryType: "THAI_GOVERNMENT",
      issuedAt: new Date("2026-10-11T08:00:00.000Z"),
      drawSequence: 1,
    })).toBe("A1011110260001");
  });

  test("แยกเดือนตามเวลาไทย", () => {
    expect(billSequencePeriod(new Date("2026-10-31T18:00:00.000Z"))).toBe("2026-11");
  });

  test("แสดงเฉพาะเลขลำดับที่อ่านง่าย", () => {
    expect(visibleBillNumber(1)).toBe("บิล 1");
    expect(visibleBillNumber(null)).toBe("บิลร่าง");
  });
});

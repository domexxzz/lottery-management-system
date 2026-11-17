import { describe, expect, test } from "vitest";
import { daysUntilExpiry, evidenceCutoff, evidenceExpiresAt, remainingLabel } from "./retention-time";

describe("อายุการเก็บรูปหลักฐาน 1 ปี", () => {
  test("ครบกำหนดหนึ่งปีตามปฏิทินนับจากเวลาที่แนบ", () => {
    expect(evidenceExpiresAt(new Date("2026-11-17T03:00:00Z")).toISOString()).toBe("2027-11-17T03:00:00.000Z");
    expect(evidenceCutoff(new Date("2027-11-17T03:00:00Z")).toISOString()).toBe("2026-11-17T03:00:00.000Z");
  });

  test("จำนวนวันที่เหลือปัดขึ้นและไม่ติดลบ", () => {
    const uploaded = new Date("2026-11-17T03:00:00Z");
    expect(daysUntilExpiry(uploaded, new Date("2026-11-17T03:00:00Z"))).toBe(365);
    expect(daysUntilExpiry(uploaded, new Date("2027-11-17T00:00:00Z"))).toBe(1);
    expect(daysUntilExpiry(uploaded, new Date("2028-01-01T00:00:00Z"))).toBe(0);
  });

  test("ข้อความที่คนอ่านเข้าใจ", () => {
    expect(remainingLabel(365)).toBe("อีก 12 เดือน 5 วัน");
    expect(remainingLabel(60)).toBe("อีก 2 เดือน");
    expect(remainingLabel(7)).toBe("อีก 7 วัน");
    expect(remainingLabel(0)).toBe("ครบกำหนดแล้ว รอระบบลบ");
  });
});

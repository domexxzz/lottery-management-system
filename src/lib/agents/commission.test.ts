import { Prisma } from "@prisma/client";
import { describe, expect, test } from "vitest";
import { effectiveCommissionRate } from "./commission";

const d = (value: string) => new Prisma.Decimal(value);
const agent = {
  commissionRate: d("30"),
  laoCommissionRate: d("28"),
  commissionPromotionStartsOn: new Date("2026-11-01T00:00:00.000Z"),
  commissionPromotionEndsOn: new Date("2026-12-01T00:00:00.000Z"),
  commissionPromotionThaiMinGross: d("20000"),
  commissionPromotionLaoMinGross: d("15000"),
  commissionPromotionThaiRate: d("35"),
  commissionPromotionLaoRate: d("30"),
};

describe("โปรโมชั่นค่าคอม Agent", () => {
  test("ถึงยอดขั้นต่ำในช่วงโปรโมชั่น ใช้เรตโปรโมชั่นแยกไทยและลาว Family", () => {
    expect(effectiveCommissionRate({ agent, lotteryType: "THAI_GOVERNMENT", drawDay: "2026-11-16", gross: d("20000") }).toString()).toBe("35");
    expect(effectiveCommissionRate({ agent, lotteryType: "LAO_SET", drawDay: "2026-11-16", gross: d("15000") }).toString()).toBe("30");
    expect(effectiveCommissionRate({ agent, lotteryType: "LAO", drawDay: "2026-11-16", gross: d("15000") }).toString()).toBe("30");
  });

  test("ไม่ถึงยอดหรืออยู่นอกช่วง ใช้เรตปกติ", () => {
    expect(effectiveCommissionRate({ agent, lotteryType: "THAI_GOVERNMENT", drawDay: "2026-11-16", gross: d("19999.99") }).toString()).toBe("30");
    expect(effectiveCommissionRate({ agent, lotteryType: "LAO", drawDay: "2026-11-16", gross: d("14999.99") }).toString()).toBe("28");
    expect(effectiveCommissionRate({ agent, lotteryType: "THAI_GOVERNMENT", drawDay: "2026-11-16", gross: d("15000") }).toString()).toBe("30");
    expect(effectiveCommissionRate({ agent, lotteryType: "LAO", drawDay: "2026-12-02", gross: d("99999") }).toString()).toBe("28");
  });

  test("ไม่ตั้งโปรโมชั่นครบ ใช้เรตปกติ", () => {
    expect(effectiveCommissionRate({
      agent: { ...agent, commissionPromotionStartsOn: null },
      lotteryType: "THAI_GOVERNMENT",
      drawDay: "2026-11-16",
      gross: d("99999"),
    }).toString()).toBe("30");
  });

  test("ตั้งโปรโมชั่นเฉพาะหวยรัฐบาลได้ โดยหวยลาวยังใช้เรตปกติ", () => {
    const thaiOnly = { ...agent, commissionPromotionLaoMinGross: null, commissionPromotionLaoRate: null };
    expect(effectiveCommissionRate({ agent: thaiOnly, lotteryType: "THAI_GOVERNMENT", drawDay: "2026-11-16", gross: d("20000") }).toString()).toBe("35");
    expect(effectiveCommissionRate({ agent: thaiOnly, lotteryType: "LAO", drawDay: "2026-11-16", gross: d("30000") }).toString()).toBe("28");
  });

  test("ตั้งโปรโมชั่นเฉพาะหวยลาวได้ โดยหวยรัฐบาลยังใช้เรตปกติ", () => {
    const laoOnly = { ...agent, commissionPromotionThaiMinGross: null, commissionPromotionThaiRate: null };
    expect(effectiveCommissionRate({ agent: laoOnly, lotteryType: "LAO_SET", drawDay: "2026-11-16", gross: d("15000") }).toString()).toBe("30");
    expect(effectiveCommissionRate({ agent: laoOnly, lotteryType: "THAI_GOVERNMENT", drawDay: "2026-11-16", gross: d("30000") }).toString()).toBe("30");
  });
});

import { Prisma } from "@prisma/client";
import { describe, expect, test } from "vitest";
import { commissionDecision, effectiveCommissionRate, hasPromotion, promotionStatus } from "./commission";

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

describe("เหตุผลประกอบอัตราคอม", () => {
  test("บอกอัตราปกติคู่กับอัตราที่ใช้จริง จึงอธิบายได้ว่าทำไมงวดนี้ได้มากกว่า", () => {
    const hit = commissionDecision({ agent, lotteryType: "THAI_GOVERNMENT", drawDay: "2026-11-16", gross: d("20000") });
    expect(hit.promotionApplied).toBe(true);
    expect(hit.rate.toString()).toBe("35");
    expect(hit.baseRate.toString()).toBe("30");

    const missed = commissionDecision({ agent, lotteryType: "THAI_GOVERNMENT", drawDay: "2026-11-16", gross: d("19999") });
    expect(missed.promotionApplied).toBe(false);
    expect(missed.rate.toString()).toBe("30");
    expect(missed.baseRate.toString()).toBe("30");
  });

  test("อยู่นอกช่วงวัน ไม่นับว่าใช้โปรโมชั่น แม้ยอดจะถึงเกณฑ์", () => {
    const decision = commissionDecision({ agent, lotteryType: "THAI_GOVERNMENT", drawDay: "2026-12-02", gross: d("99999") });
    expect(decision.promotionApplied).toBe(false);
  });
});

describe("สถานะโปรโมชั่นเทียบกับวันนี้", () => {
  test("แยกใกล้หมดอายุออกจากใช้งานอยู่ เพื่อให้เตือนก่อนหมดได้", () => {
    expect(promotionStatus(agent, "2026-11-10").state).toBe("ACTIVE");
    expect(promotionStatus(agent, "2026-11-28").state).toBe("ENDING_SOON");
    expect(promotionStatus(agent, "2026-12-01").state).toBe("ENDING_SOON");
    expect(promotionStatus(agent, "2026-12-02").state).toBe("EXPIRED");
    expect(promotionStatus(agent, "2026-10-31").state).toBe("SCHEDULED");
  });

  test("วันสุดท้ายยังนับเป็นวันที่ใช้ได้ daysLeft เป็นศูนย์ ไม่ใช่ติดลบ", () => {
    expect(promotionStatus(agent, "2026-12-01").daysLeft).toBe(0);
    expect(promotionStatus(agent, "2026-11-30").daysLeft).toBe(1);
  });

  test("ตั้งไม่ครบถือว่าไม่มีโปรโมชั่น ไม่ใช่หมดอายุ", () => {
    const none = { ...agent, commissionPromotionThaiMinGross: null, commissionPromotionThaiRate: null, commissionPromotionLaoMinGross: null, commissionPromotionLaoRate: null };
    expect(promotionStatus(none, "2026-11-16").state).toBe("NONE");
    expect(hasPromotion(none)).toBe(false);
    expect(hasPromotion(agent)).toBe(true);
  });
});

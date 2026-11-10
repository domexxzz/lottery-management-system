import { describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { commissionOf, itemPayout, netOf, reducedPayoutRate, sumMoney, toMoney } from "./money";

const d = (v: string | number) => new Prisma.Decimal(v);

describe("toMoney — ปัดครึ่งขึ้น 2 ตำแหน่ง", () => {
  test("ปัดขึ้นเมื่อครึ่งพอดี", () => {
    expect(toMoney(d("0.125")).toFixed(2)).toBe("0.13");
    expect(toMoney(d("1.005")).toFixed(2)).toBe("1.01");
  });

  test("ปัดลงเมื่อน้อยกว่าครึ่ง", () => {
    expect(toMoney(d("0.124")).toFixed(2)).toBe("0.12");
  });

  test("ค่าที่มีทศนิยมไม่เกินสองตำแหน่งอยู่แล้วไม่เปลี่ยน", () => {
    expect(toMoney(d("10.50")).toFixed(2)).toBe("10.50");
  });

  test("ไม่เพี้ยนแบบ float", () => {
    // 0.1 + 0.2 ด้วย float จะได้ 0.30000000000000004
    expect(sumMoney([d("0.1"), d("0.2")]).equals(d("0.3"))).toBe(true);
  });
});

describe("itemPayout — ยอดจ่ายรายรายการ", () => {
  test("คูณเงินเดิมพันกับอัตราจ่ายที่ล็อกไว้", () => {
    expect(itemPayout(d("100"), d("900")).toFixed(2)).toBe("90000.00");
  });

  test("รองรับอัตราจ่ายที่มีทศนิยม", () => {
    // เลขวิ่ง จ่าย 2.5 เท่า
    expect(itemPayout(d("50"), d("2.5")).toFixed(2)).toBe("125.00");
  });

  test("ปัดที่ระดับรายการ", () => {
    // ทดสอบการปัดเศษด้วยอัตราทศนิยมที่ไม่ลงตัว
    expect(itemPayout(d("33.33"), d("3.2")).toFixed(2)).toBe("106.66");
  });

  test("เงินเดิมพันศูนย์ได้ยอดจ่ายศูนย์", () => {
    expect(itemPayout(d("0"), d("900")).toFixed(2)).toBe("0.00");
  });
});

describe("reducedPayoutRate — เลขอั้นจ่ายครึ่งหนึ่ง", () => {
  test.each([
    ["650", "325.0000"],
    ["100", "50.0000"],
    ["75", "37.5000"],
  ])("อัตราปกติ %s เหลือ %s", (normal, reduced) => {
    expect(reducedPayoutRate(d(normal)).toFixed(4)).toBe(reduced);
  });

  test("2 ตัวบนอัตราปกติ 75 เลขอั้นจ่าย 38 ตามกติกาธุรกิจ", () => {
    expect(reducedPayoutRate(d("75"), 5).toFixed(4)).toBe("38.0000");
  });

  test("2 ตัวล่างอัตราปกติ 75 เลขอั้นจ่าย 38 เท่ากับ 2 ตัวบน", () => {
    expect(reducedPayoutRate(d("75"), 6).toFixed(4)).toBe("38.0000");
  });
});

describe("commissionOf — คิดจากยอดขายรวม", () => {
  test("อัตราธุรกิจ 30% จากยอดเดิมพันรวม", () => {
    expect(
      commissionOf({ gross: d("1000"), payout: d("90000"), commissionRatePercent: d("30") }).toFixed(2),
    ).toBe("300.00");
  });

  test("คำนวณตามเปอร์เซ็นต์", () => {
    expect(
      commissionOf({ gross: d("1000"), payout: d("0"), commissionRatePercent: d("25") }).toFixed(2),
    ).toBe("250.00");
  });

  test("ไม่ขึ้นกับยอดจ่ายรางวัล", () => {
    const withoutPayout = commissionOf({
      gross: d("1000"),
      payout: d("0"),
      commissionRatePercent: d("25"),
    });
    const withPayout = commissionOf({
      gross: d("1000"),
      payout: d("5000"),
      commissionRatePercent: d("25"),
    });
    expect(withPayout.equals(withoutPayout)).toBe(true);
  });

  test("อัตราที่มีทศนิยม", () => {
    expect(
      commissionOf({ gross: d("1000"), payout: d("0"), commissionRatePercent: d("22.5") }).toFixed(2),
    ).toBe("225.00");
  });

  test("ปัดครึ่งขึ้น", () => {
    // 333.33 × 25% = 83.3325 -> 83.33
    expect(
      commissionOf({ gross: d("333.33"), payout: d("0"), commissionRatePercent: d("25") }).toFixed(2),
    ).toBe("83.33");
  });

  test("อัตราศูนย์ได้คอมศูนย์", () => {
    expect(
      commissionOf({ gross: d("1000"), payout: d("0"), commissionRatePercent: d("0") }).toFixed(2),
    ).toBe("0.00");
  });
});

describe("netOf — ผลสุทธิ", () => {
  test("ระบบได้เงินเมื่อยอดขายมากกว่ารางวัลบวกคอม", () => {
    expect(
      netOf({ gross: d("1000"), payout: d("200"), commission: d("250") }).toFixed(2),
    ).toBe("550.00");
  });

  test("ติดลบได้เมื่อจ่ายรางวัลมากกว่ายอดขาย", () => {
    expect(
      netOf({ gross: d("1000"), payout: d("5000"), commission: d("250") }).toFixed(2),
    ).toBe("-4250.00");
  });

  test("เป็นศูนย์เมื่อหักกันพอดี", () => {
    expect(netOf({ gross: d("1000"), payout: d("750"), commission: d("250") }).toFixed(2)).toBe(
      "0.00",
    );
  });
});

describe("ตัวอย่างรอบจริงหนึ่งรอบ", () => {
  test("คำนวณครบตั้งแต่รายการถึงผลสุทธิ", () => {
    // Agent คอม 25% ขายสองรายการ ถูกรางวัลหนึ่งรายการ
    const stakes = [d("100"), d("50")];
    const gross = sumMoney(stakes);
    expect(gross.toFixed(2)).toBe("150.00");

    // รายการแรกถูก 3 ตัวบน จ่าย 900 เท่า
    const payout = sumMoney([itemPayout(d("100"), d("900"))]);
    expect(payout.toFixed(2)).toBe("90000.00");

    const commission = commissionOf({ gross, payout, commissionRatePercent: d("25") });
    expect(commission.toFixed(2)).toBe("37.50");

    const net = netOf({ gross, payout, commission });
    expect(net.toFixed(2)).toBe("-89887.50");
  });

  test("รอบที่ไม่มีใครถูกรางวัล", () => {
    const gross = sumMoney([d("100"), d("50")]);
    const payout = sumMoney([]);
    const commission = commissionOf({ gross, payout, commissionRatePercent: d("25") });
    const net = netOf({ gross, payout, commission });

    expect(payout.toFixed(2)).toBe("0.00");
    expect(commission.toFixed(2)).toBe("37.50");
    expect(net.toFixed(2)).toBe("112.50");
  });
});

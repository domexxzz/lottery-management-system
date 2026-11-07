import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { enterResult } from "@/lib/results/service";
import { calculateSettlement } from "@/lib/settlement/service";
import { buildOwnerAnalytics } from "./analytics";

/**
 * การวิเคราะห์ที่คำนวณด้วย SQL
 *
 * ชุดนี้พิสูจน์สองเรื่องที่โมเดลภาษาทำแทนไม่ได้
 *   1. เลขคณิตถูกต้อง — ภาระผูกพัน ยอดเฉลี่ย เปอร์เซ็นต์เปลี่ยนแปลง
 *   2. ขอบเขตองค์กรไม่รั่ว — ข้อมูลองค์กรอื่นต้องไม่โผล่มาแม้แต่แถวเดียว
 */

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function billFor(
  actor: Fixtures["actors"]["AGENT1"],
  title: string,
  items: { prizeTypeId: string; number: string; stake: string }[],
  drawId = f.draw.id,
) {
  const { billId } = await createDraftBill(actor, { drawId, title });
  await replaceDraftItems(actor, billId, items);
  await confirmBill(actor, billId);
  return billId;
}

describe("ประเมินความเสี่ยง", () => {
  test("คำนวณยอดที่ต้องจ่ายถ้าเลขนั้นออก จากอัตราที่ล็อกไว้ตอนยืนยันบิล", async () => {
    const { threeTop } = f.prizeTypes;
    // 3 ตัวบน จ่าย 900 เท่า → 100 บาท = ภาระ 90,000
    await billFor(f.actors.AGENT1, "ลูกค้า-ก", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await billFor(f.actors.AGENT1, "ลูกค้า-ข", [
      { prizeTypeId: threeTop.id, number: "123", stake: "50" },
    ]);
    await billFor(f.actors.AGENT1, "ลูกค้า-ค", [
      { prizeTypeId: threeTop.id, number: "999", stake: "10" },
    ]);

    const { riskExposure } = await buildOwnerAnalytics(f.actors.OWNER);

    expect(riskExposure.drawName).toBe("งวดทดสอบ");
    expect(riskExposure.totalStake).toBe("160.00");

    const top = riskExposure.details[0]!;
    expect(top.number).toBe("123");
    expect(top.itemCount).toBe(2);
    expect(top.stake).toBe("150.00");
    // (100 + 50) × 900
    expect(top.payoutIfWins).toBe("135000.00");
    // ยอดขายทั้งรอบ 160 ลบภาระ 135,000
    expect(top.netIfWins).toBe("-134840.00");

    const second = riskExposure.details[1]!;
    expect(second.number).toBe("999");
    expect(second.payoutIfWins).toBe("9000.00");
  });

  test("เรียงจากภาระผูกพันสูงสุด ไม่ใช่จากยอดเดิมพัน", async () => {
    const { threeTop, runTop } = f.prizeTypes;
    // วิ่งบนจ่าย 3.2 เท่า เดิมพันสูงแต่ภาระต่ำ
    await billFor(f.actors.AGENT1, "ลูกค้า-ก", [
      { prizeTypeId: runTop.id, number: "7", stake: "1000" },
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);

    const { riskExposure } = await buildOwnerAnalytics(f.actors.OWNER);

    // เดิมพัน 1000 แต่ภาระแค่ 3,200 ส่วนเดิมพัน 100 มีภาระ 90,000
    expect(riskExposure.details[0]!.number).toBe("123");
    expect(riskExposure.details[0]!.payoutIfWins).toBe("90000.00");
    expect(riskExposure.details[1]!.number).toBe("7");
    expect(riskExposure.details[1]!.payoutIfWins).toBe("3200.00");
  });

  test("ไม่นับบิลร่างที่ยังไม่ยืนยัน เพราะยังไม่มีภาระผูกพัน", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor(f.actors.AGENT1, "ยืนยันแล้ว", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    const { billId } = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ยังเป็นร่าง",
    });
    await replaceDraftItems(f.actors.AGENT1, billId, [
      { prizeTypeId: threeTop.id, number: "123", stake: "99999" },
    ]);

    const { riskExposure } = await buildOwnerAnalytics(f.actors.OWNER);
    expect(riskExposure.totalStake).toBe("100.00");
    expect(riskExposure.details[0]!.payoutIfWins).toBe("90000.00");
  });

  test("ไม่มีรอบที่เปิดอยู่ ตอบว่าไม่มีภาระผูกพัน ไม่ใช่ล้ม", async () => {
    await prisma.draw.update({
      where: { id: f.draw.id },
      data: { status: "CLOSED" },
    });
    const { riskExposure } = await buildOwnerAnalytics(f.actors.OWNER);
    expect(riskExposure.drawName).toBeNull();
    expect(riskExposure.details).toEqual([]);
    expect(riskExposure.theoreticalMaxPayout).toBe("0.00");
  });
});

describe("พฤติกรรมลูกค้า", () => {
  test("จัดอันดับตามยอดซื้อรวม พร้อมความถี่และยอดเฉลี่ย", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor(f.actors.AGENT1, "ลูกค้ารายใหญ่", [
      { prizeTypeId: threeTop.id, number: "111", stake: "300" },
    ]);
    await billFor(f.actors.AGENT1, "ลูกค้ารายใหญ่", [
      { prizeTypeId: threeTop.id, number: "222", stake: "100" },
    ]);
    await billFor(f.actors.AGENT1, "ลูกค้ารายเล็ก", [
      { prizeTypeId: threeTop.id, number: "333", stake: "50" },
    ]);

    const { customerBehavior } = await buildOwnerAnalytics(f.actors.OWNER);

    expect(customerBehavior.totalCustomers).toBe(2);
    expect(customerBehavior.repeatCustomers).toBe(1);

    const top = customerBehavior.topCustomers[0]!;
    expect(top.customerReference).toBe("ลูกค้ารายใหญ่");
    expect(top.bills).toBe(2);
    expect(top.totalSpend).toBe("400.00");
    expect(top.averageBill).toBe("200.00");
    expect(top.drawsPlayed).toBe(1);
    expect(top.lastSeenDraw).toBe("งวดทดสอบ");

    expect(customerBehavior.topCustomers[1]!.customerReference).toBe("ลูกค้ารายเล็ก");
  });

  test("ลูกค้าที่ไม่ซื้อในรอบล่าสุดนับเป็นหายไป", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor(f.actors.AGENT1, "ลูกค้าเก่า", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);

    // ไม่มีลูกค้าหายไป เพราะทุกคนซื้อในรอบเดียวที่มี
    expect((await buildOwnerAnalytics(f.actors.OWNER)).customerBehavior.churnedCustomers).toBe(0);

    // สร้างอีก 3 รอบที่ลูกค้าเก่าไม่ได้ซื้อเลย จนหลุดหน้าต่าง 3 รอบล่าสุด
    const now = new Date();
    for (const offset of [1, 2, 3]) {
      await prisma.draw.create({
        data: {
          organizationId: f.org.id,
          name: `รอบถัดไป-${offset}`,
          opensAt: new Date(now.getTime() + offset * 86_400_000),
          cutoffAt: new Date(now.getTime() + offset * 86_400_000 + 3_600_000),
          status: "OPEN",
        },
      });
    }

    const { customerBehavior } = await buildOwnerAnalytics(f.actors.OWNER);
    expect(customerBehavior.churnWindowDraws).toBe(3);
    expect(customerBehavior.churnedCustomers).toBe(1);
  });

  test("ไม่มีลูกค้าเลย ไม่ล้มและไม่หารด้วยศูนย์", async () => {
    const { customerBehavior } = await buildOwnerAnalytics(f.actors.OWNER);
    expect(customerBehavior.totalCustomers).toBe(0);
    expect(customerBehavior.averageSpendPerCustomer).toBe("0.00");
    expect(customerBehavior.topCustomers).toEqual([]);
  });
});

describe("แนวโน้มยอดขาย", () => {
  test("เรียงจากรอบเก่าไปใหม่ พร้อมเปอร์เซ็นต์เทียบรอบก่อน", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor(f.actors.AGENT1, "ลูกค้า", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);

    const now = new Date();
    const later = await prisma.draw.create({
      data: {
        organizationId: f.org.id,
        name: "รอบถัดมา",
        opensAt: new Date(now.getTime() + 86_400_000),
        cutoffAt: new Date(now.getTime() + 90_000_000),
        status: "OPEN",
      },
    });
    await billFor(
      f.actors.AGENT1,
      "ลูกค้า",
      [{ prizeTypeId: threeTop.id, number: "123", stake: "150" }],
      later.id,
    );

    const { salesTrend } = await buildOwnerAnalytics(f.actors.OWNER);

    expect(salesTrend.details.map((d) => d.drawName)).toEqual(["งวดทดสอบ", "รอบถัดมา"]);
    expect(salesTrend.details[0]!.changeFromPreviousPercent).toBeNull();
    // 100 → 150 คือ +50%
    expect(salesTrend.details[1]!.changeFromPreviousPercent).toBe("50.00");
    expect(salesTrend.direction).toBe("increasing");
  });

  test("รอบเดียวบอกทิศทางไม่ได้", async () => {
    const { salesTrend } = await buildOwnerAnalytics(f.actors.OWNER);
    expect(salesTrend.direction).toBe("insufficient_data");
  });
});

describe("ขอบเขตองค์กร", () => {
  test("ข้อมูลขององค์กรอื่นไม่รั่วเข้ามาแม้แต่แถวเดียว", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor(f.actors.AGENT1, "ลูกค้าของเรา", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);

    // องค์กรที่สองพร้อมข้อมูลครบชุดของตัวเอง
    const otherOrg = await prisma.organization.create({
      data: { name: "องค์กรอื่น", timezone: "Asia/Bangkok" },
    });
    const otherPrize = await prisma.prizeType.create({
      data: {
        organizationId: otherOrg.id,
        code: 1,
        name: "3 ตัวบน",
        digits: 3,
        matchRule: "EXACT",
        payoutRate: "900",
      },
    });
    const otherAgent = await prisma.agent.create({
      data: {
        organizationId: otherOrg.id,
        code: "B001",
        name: "ตัวแทนองค์กรอื่น",
        commissionRate: "25",
      },
    });
    const otherUser = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        login: "other-owner",
        displayName: "เจ้าของอื่น",
        passwordHash: "x",
        role: "OWNER",
        mustChangePassword: false,
      },
    });
    const otherDraw = await prisma.draw.create({
      data: {
        organizationId: otherOrg.id,
        name: "งวดองค์กรอื่น",
        opensAt: new Date(Date.now() - 3_600_000),
        cutoffAt: new Date(Date.now() + 3_600_000),
        status: "OPEN",
      },
    });
    const otherBill = await prisma.bill.create({
      data: {
        organizationId: otherOrg.id,
        agentId: otherAgent.id,
        drawId: otherDraw.id,
        title: "ลูกค้าองค์กรอื่น",
        status: "CONFIRMED",
        billNumber: "99999999",
        totalStake: "999999",
        createdById: otherUser.id,
      },
    });
    await prisma.billItem.create({
      data: {
        organizationId: otherOrg.id,
        billId: otherBill.id,
        prizeTypeId: otherPrize.id,
        number: "777",
        stake: "999999",
        payoutRateSnapshot: "900",
      },
    });

    const analytics = await buildOwnerAnalytics(f.actors.OWNER);
    const serialized = JSON.stringify(analytics);

    expect(serialized).not.toContain("องค์กรอื่น");
    expect(serialized).not.toContain("ลูกค้าองค์กรอื่น");
    expect(serialized).not.toContain("777");
    expect(serialized).not.toContain("999999");
    expect(analytics.customerBehavior.totalCustomers).toBe(1);
    expect(analytics.riskExposure.totalStake).toBe("100.00");
  });
});

describe("ตัวเลขมาจากข้อมูลจริงหลัง settlement", () => {
  test("ยอดที่ลูกค้าถูกรางวัลนับจาก totalPayout จริง", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor(f.actors.AGENT1, "ผู้โชคดี", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: threeTop.id,
      value: "123",
    });
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    const { customerBehavior } = await buildOwnerAnalytics(f.actors.OWNER);
    const winner = customerBehavior.topCustomers.find(
      (c) => c.customerReference === "ผู้โชคดี",
    )!;
    expect(winner.totalSpend).toBe("100.00");
    expect(winner.totalWon).toBe("90000.00");
  });
});

describe("ไม่มีภาระผูกพัน ต้องบอกชัดว่าไม่มี", () => {
  test("รอบเปิดใหม่ที่ยังไม่มีบิล ไม่ดึงรอบเก่ามาแทน แต่ประกาศว่าไม่มีความเสี่ยง", async () => {
    // รอบเดียวในระบบยังไม่มีบิลเลย
    const { riskExposure } = await buildOwnerAnalytics(f.actors.OWNER);
    expect(riskExposure.hasExposure).toBe(false);
    expect(riskExposure.details).toEqual([]);
    expect(riskExposure.summary).toContain("ไม่มีภาระผูกพัน");
  });

  test("รอบใหม่ไม่มีบิล แต่รอบก่อนยังไม่ปิดบัญชีและมีบิล ต้องรายงานรอบที่มีภาระจริง", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor(f.actors.AGENT1, "ลูกค้า", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);

    // เปิดรอบใหม่ที่ยังไม่มีใครซื้อ และมี cutoff ใหม่กว่า
    const now = new Date();
    await prisma.draw.create({
      data: {
        organizationId: f.org.id,
        name: "รอบเปิดใหม่ยังไม่มีบิล",
        opensAt: new Date(now.getTime() + 86_400_000),
        cutoffAt: new Date(now.getTime() + 90_000_000),
        status: "OPEN",
      },
    });

    const { riskExposure } = await buildOwnerAnalytics(f.actors.OWNER);
    // ต้องไม่เลือกรอบใหม่ที่ว่างเปล่า เพราะภาระจริงอยู่ที่รอบก่อน
    expect(riskExposure.drawName).toBe("งวดทดสอบ");
    expect(riskExposure.hasExposure).toBe(true);
    expect(riskExposure.details[0]!.payoutIfWins).toBe("90000.00");
  });

  test("รอบที่ปิดบัญชีแล้วไม่นับเป็นความเสี่ยงปัจจุบัน", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor(f.actors.AGENT1, "ลูกค้า", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await prisma.draw.update({ where: { id: f.draw.id }, data: { status: "CLOSED" } });

    const { riskExposure } = await buildOwnerAnalytics(f.actors.OWNER);
    expect(riskExposure.hasExposure).toBe(false);
    expect(riskExposure.details).toEqual([]);
  });
});

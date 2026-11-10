import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { listBetBills, placeBill, recentCustomerNames } from "./service";
import { addRestriction, removeRestriction } from "@/lib/draws/restrictions";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

describe("หน้าแทงเลข: placeBill", () => {
  test("สร้างและยืนยันโพยในขั้นตอนเดียว พร้อมเลขโพยและ snapshot อัตราจ่าย", async () => {
    const placed = await placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "พี่ก็อต",
      items: [
        { prizeTypeId: f.prizeTypes.threeTop.id, number: "483", stake: "50" },
        { prizeTypeId: f.prizeTypes.threeTop.id, number: "438", stake: "50" },
      ],
    });

    const bill = await prisma.bill.findUniqueOrThrow({ where: { id: placed.billId }, include: { items: true } });
    expect(bill.status).toBe("CONFIRMED");
    expect(bill.billNumber).toBe(placed.billNumber);
    expect(bill.drawSequence).toBe(1);
    expect(placed.drawSequence).toBe(1);
    expect(bill.totalStake.toFixed(2)).toBe("100.00");
    expect(bill.items.every((item) => item.payoutRateSnapshot.equals(f.prizeTypes.threeTop.payoutRate))).toBe(true);

    const audits = await prisma.auditEvent.findMany({ where: { entityId: bill.id }, select: { action: true } });
    expect(audits.map((audit) => audit.action).sort()).toEqual(["CONFIRM", "CREATE"]);
  });

  test("เลขบิลนับต่อราย Agent ในเดือนเดียวกันแม้เปลี่ยนงวด และ Agent อื่นเริ่มที่ 1", async () => {
    const item = [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }];
    const first = await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า 1", items: item });
    const second = await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า 2", items: item });
    const otherDraw = await prisma.draw.create({
      data: {
        organizationId: f.org.id,
        name: "งวดใหม่",
        opensAt: new Date(Date.now() - 60_000),
        cutoffAt: new Date(Date.now() + 86_400_000),
      },
    });
    const continued = await placeBill(f.actors.AGENT1, { drawId: otherDraw.id, title: "ลูกค้า 3", items: item });
    const otherAgent = await placeBill(f.actors.AGENT2, { drawId: otherDraw.id, title: "ลูกค้า 4", items: item });

    expect([first.drawSequence, second.drawSequence, continued.drawSequence, otherAgent.drawSequence]).toEqual([1, 2, 3, 1]);
    expect(first.billNumber).toMatch(/^A00101\d{6}0001$/);
    expect(second.billNumber).toMatch(/^A00101\d{6}0002$/);
    expect(continued.billNumber).toMatch(/^A00101\d{6}0003$/);
    expect(otherAgent.billNumber).toMatch(/^A00201\d{6}0001$/);
  });

  test("ข้อใดไม่ผ่าน rollback ทั้งหมด ไม่มีบิลร่างค้าง", async () => {
    await expect(placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "12", stake: "10" }],
    })).rejects.toThrow(/3 หลัก/);
    expect(await prisma.bill.count()).toBe(0);
  });

  test("ปฏิเสธเมื่อเลยเวลาปิดรับ", async () => {
    await prisma.draw.update({ where: { id: f.draw.id }, data: { cutoffAt: new Date(Date.now() - 1000) } });
    await expect(placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }],
    })).rejects.toThrow(/หมดเวลาการเดิมพัน/);
  });
});

describe("เลขเต็มและเลขอั้น", () => {
  test("เลขเต็มปิดรับ ส่วนเลขอั้น snapshot ครึ่งหนึ่งของอัตราปกติ", async () => {
    await addRestriction(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTop.id, number: "999", kind: "CLOSED" });
    await addRestriction(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTop.id, number: "123", kind: "REDUCED_RATE" });

    await expect(placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "999", stake: "10" }],
    })).rejects.toThrow(/เลขเต็ม/);

    const placed = await placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
      items: [
        { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" },
        { prizeTypeId: f.prizeTypes.threeTop.id, number: "124", stake: "10" },
      ],
    });
    const items = await prisma.billItem.findMany({ where: { billId: placed.billId }, orderBy: { number: "asc" } });
    expect(items[0]?.payoutRateSnapshot.toFixed(0)).toBe("450");
    expect(items[1]?.payoutRateSnapshot.equals(f.prizeTypes.threeTop.payoutRate)).toBe(true);
  });

  test("เลขเต็มของรางวัลโต๊ดครอบคลุมเลขสลับหลัก", async () => {
    await addRestriction(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTod.id, number: "321", kind: "CLOSED" });
    await expect(placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
      items: [{ prizeTypeId: f.prizeTypes.threeTod.id, number: "213", stake: "10" }],
    })).rejects.toThrow(/เลขเต็ม/);
  });

  test("กำหนดเลขอั้นภายหลังแล้วปรับอัตราของบิลเดิมที่ยังไม่ตรวจผล", async () => {
    const placed = await placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "บิลก่อนประกาศเลขอั้น",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }],
    });

    await addRestriction(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      number: "123",
      kind: "REDUCED_RATE",
    });

    const item = await prisma.billItem.findFirstOrThrow({ where: { billId: placed.billId } });
    expect(item.payoutRateSnapshot.equals(f.prizeTypes.threeTop.payoutRate.dividedBy(2))).toBe(true);
  });

  test("เลขอั้นโต๊ดที่ประกาศภายหลังปรับบิลเดิมทุกลำดับของเลขชุดเดียวกัน", async () => {
    const placed = await placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "โต๊ดก่อนประกาศ",
      items: [{ prizeTypeId: f.prizeTypes.threeTod.id, number: "213", stake: "10" }],
    });

    await addRestriction(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTod.id,
      number: "123",
      kind: "REDUCED_RATE",
    });

    const item = await prisma.billItem.findFirstOrThrow({ where: { billId: placed.billId } });
    expect(item.payoutRateSnapshot.equals(f.prizeTypes.threeTod.payoutRate.dividedBy(2))).toBe(true);
  });

  test("Agent ตั้งเลขเต็มหรือเลขอั้นไม่ได้", async () => {
    await expect(addRestriction(f.actors.AGENT1, { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTop.id, number: "111", kind: "CLOSED" }))
      .rejects.toThrow();
    await expect(addRestriction(f.actors.AGENT1, { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTop.id, number: "111", kind: "REDUCED_RATE" }))
      .rejects.toThrow();
  });

  test("ยกเลิกเลขเต็มแล้วแทงได้อีก", async () => {
    await addRestriction(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTop.id, number: "555", kind: "CLOSED" });
    const row = await prisma.restrictedNumber.findFirstOrThrow();
    await removeRestriction(f.actors.ADMIN, row.id);
    await expect(placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "555", stake: "10" }],
    })).resolves.toMatchObject({ billNumber: expect.any(String) });
  });
});

describe("รายการโพยของ Agent", () => {
  test("แยกแท็บตามสถานะ และ Agent เห็นเฉพาะโพยของตัวเอง", async () => {
    const mine = await placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ของฉัน",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }],
    });
    await placeBill(f.actors.AGENT2, {
      drawId: f.draw.id,
      title: "ของคนอื่น",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }],
    });
    await prisma.bill.update({ where: { id: mine.billId }, data: { status: "SETTLED", totalPayout: 0 } });

    const all = await listBetBills(f.actors.AGENT1, { tab: "ALL" });
    expect(all.bills.map((bill) => bill.title)).toEqual(["ของฉัน"]);
    expect(all.counts).toEqual({ ALL: 1, PENDING: 0, WON: 0, LOST: 1, CANCELLED: 0 });

    await prisma.bill.update({ where: { id: mine.billId }, data: { totalPayout: 900 } });
    const won = await listBetBills(f.actors.AGENT1, { tab: "WON" });
    expect(won.bills).toHaveLength(1);
    expect(won.counts.LOST).toBe(0);
  });
});

describe("ประวัติรายการแบบแบ่งหน้า", () => {
  test("ดึงเฉพาะแถวของหน้าที่ขอ และหน้าที่เกินจะถูกปัดกลับหน้าสุดท้าย", async () => {
    for (let index = 0; index < 3; index += 1) {
      await placeBill(f.actors.AGENT1, {
        drawId: f.draw.id,
        title: `ลูกค้า ${index}`,
        items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: `12${index}`, stake: "10" }],
      });
    }

    const first = await listBetBills(f.actors.AGENT1, { tab: "ALL", page: 1, pageSize: 2 });
    expect(first.bills).toHaveLength(2);
    expect(first.pageCount).toBe(2);
    expect(first.total).toBe(3);
    expect(first.totals.stake.toFixed(2)).toBe("30.00");

    const beyond = await listBetBills(f.actors.AGENT1, { tab: "ALL", page: 9, pageSize: 2 });
    expect(beyond.page).toBe(2);
    expect(beyond.bills).toHaveLength(1);

    expect(await recentCustomerNames(f.actors.AGENT1, f.actors.AGENT1.agentId!)).toEqual(["ลูกค้า 2", "ลูกค้า 1", "ลูกค้า 0"]);
  });

  test("Agent กรองด้วย agentId ของคนอื่นไม่ได้", async () => {
    await placeBill(f.actors.AGENT2, {
      drawId: f.draw.id,
      title: "ของคนอื่น",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }],
    });
    const result = await listBetBills(f.actors.AGENT1, { tab: "ALL", agentId: f.actors.AGENT2.agentId! });
    expect(result.total).toBe(0);
  });
});

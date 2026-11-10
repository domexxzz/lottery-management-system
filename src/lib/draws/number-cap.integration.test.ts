import { beforeEach, describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { placeBill, softDeleteBillBeforeCutoff, updateBillBeforeCutoff } from "@/lib/bills/service";
import { updateNumberCap } from "./restrictions";
import { fullNumbersByDraw } from "./number-cap";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

const bet = (prizeTypeId: string, number: string, stake: string) => [{ prizeTypeId, number, stake }];

describe("เพดานรับต่อเลข", () => {
  test("งวดใหม่มีเพดานเริ่มต้น 2,000 บาท", async () => {
    const draw = await prisma.draw.findUniqueOrThrow({ where: { id: f.draw.id }, select: { numberCap: true } });
    expect(draw.numberCap?.toFixed(2)).toBe("2000.00");
  });

  test("ยอดรวมทุก Agent ครบ 2,000 แล้วเป็นเลขเต็ม", async () => {
    const top = f.prizeTypes.threeTop.id;
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า 1", items: bet(top, "123", "1000") });
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า 1", items: bet(top, "123", "500") });
    await expect(placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ลูกค้า 2", items: bet(top, "123", "600") }))
      .rejects.toThrow(/รับได้อีก 500 บาท/);
    await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ลูกค้า 2", items: bet(top, "123", "500") });
    await expect(placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า 3", items: bet(top, "123", "5") }))
      .rejects.toThrow(/เป็นเลขเต็ม/);

    // เลขอื่น และเลขเดียวกันแต่คนละประเภท ยังรับได้
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า 4", items: bet(top, "124", "10") });
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า 5", items: bet(f.prizeTypes.threeTod.id, "123", "10") });

    const full = (await fullNumbersByDraw(prisma, f.org.id, [{ id: f.draw.id, numberCap: new Prisma.Decimal(2000) }])).get(f.draw.id);
    expect(full?.map((row) => [row.prizeTypeId, row.number])).toEqual([[top, "123"]]);
  });

  test("โต๊ดนับเลขสลับหลักรวมกัน", async () => {
    const tod = f.prizeTypes.threeTod.id;
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: bet(tod, "123", "1000") });
    await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ข", items: bet(tod, "321", "1000") });
    await expect(placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ค", items: bet(tod, "213", "5") }))
      .rejects.toThrow(/เป็นเลขเต็ม/);
  });

  test("บิลที่ลบแล้วคืนยอดให้เลขนั้น และแก้บิลเดิมไม่นับยอดของตัวเองซ้ำ", async () => {
    const top = f.prizeTypes.threeTop.id;
    const first = await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: bet(top, "777", "1000") });
    await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ข", items: bet(top, "777", "1000") });
    await updateBillBeforeCutoff(f.actors.AGENT1, first.billId, { title: "ก", items: bet(top, "777", "900") });
    await softDeleteBillBeforeCutoff(f.actors.AGENT1, first.billId);
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ค", items: bet(top, "777", "1000") });
  });

  test("ยืนยันพร้อมกันก็ไม่รวมกันเกินเพดาน", async () => {
    const top = f.prizeTypes.threeTop.id;
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: bet(top, "555", "1000") });
    const outcomes = await Promise.allSettled([
      placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ข", items: bet(top, "555", "800") }),
      placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ค", items: bet(top, "555", "800") }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const sum = await prisma.billItem.aggregate({
      where: { number: "555", bill: { drawId: f.draw.id, status: "CONFIRMED" } },
      _sum: { stake: true },
    });
    expect(sum._sum.stake?.toFixed(2)).toBe("1800.00");
  });

  test("Owner เปลี่ยนเพดานหรือตั้งไม่จำกัดได้ Agent เปลี่ยนไม่ได้", async () => {
    const top = f.prizeTypes.threeTop.id;
    await updateNumberCap(f.actors.OWNER, f.draw.id, "500");
    await expect(placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: bet(top, "111", "600") }))
      .rejects.toThrow(/รับได้อีก 500 บาท/);
    await updateNumberCap(f.actors.ADMIN, f.draw.id, "");
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: bet(top, "111", "1000") });
    await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ข", items: bet(top, "111", "1000") });
    await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ค", items: bet(top, "111", "1000") });
    await expect(updateNumberCap(f.actors.AGENT1, f.draw.id, "100")).rejects.toThrow();
    await expect(updateNumberCap(f.actors.OWNER, f.draw.id, "-5")).rejects.toThrow(/มากกว่า 0/);
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: f.draw.id, entityType: "Draw" } });
    expect(audit).not.toBeNull();
  });
});

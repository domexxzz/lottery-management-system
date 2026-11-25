import { beforeEach, describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { toBangkokDateTimeLocal } from "@/lib/draws/schedule";
import { addRestriction } from "@/lib/draws/restrictions";
import { BillItemsRejectedError } from "@/lib/errors";
import { LAO_PRIZE_TYPES } from "@/lib/lao/rules";
import { createLaoDraws } from "@/lib/lao/service";
import { exportBetBills, listBetBills, placeBill, placeSlip } from "./service";

/**
 * บิลเดียวหลายประเภทหวย: ผู้ใช้เห็นบิลเดียว (เลขบิลเดียว) ระบบเก็บบิลย่อยต่องวด
 */
let f: Fixtures;
let lao: string;
let laoSet: string;
let pt: Record<number, string>;

function nextWeekday(): string {
  const date = new Date(Date.now() + 7 * 86_400_000);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

beforeEach(async () => {
  f = await freshFixtures();
  for (const prize of LAO_PRIZE_TYPES) {
    await prisma.prizeType.create({
      data: {
        organizationId: f.org.id,
        code: prize.code,
        name: prize.name,
        digits: prize.digits,
        matchRule: prize.matchRule,
        lotteryType: prize.lotteryType,
        payoutRate: new Prisma.Decimal(prize.payoutRate),
        isActive: prize.isActive,
      },
    });
  }
  pt = Object.fromEntries((await prisma.prizeType.findMany({ where: { organizationId: f.org.id, code: { gte: 100 } } })).map((row) => [row.code, row.id]));
  const { drawIds } = await createLaoDraws(f.actors.ADMIN, {
    drawDate: nextWeekday(),
    opensAt: toBangkokDateTimeLocal(new Date(Date.now() - 3_600_000)),
    cutoffAt: toBangkokDateTimeLocal(new Date(Date.now() + 3_600_000)),
    lotteryTypes: ["LAO", "LAO_SET"],
  });
  lao = drawIds[0]!;
  laoSet = drawIds[1]!;
});

const bet = (prizeTypeId: string, number: string, stake: string) => ({ prizeTypeId, number, stake });

describe("บิลเดียวหลายประเภทหวย", () => {
  test("หวยลาว + หวยลาวชุด: ได้เลขบิลเดียว เก็บแยกต่องวด ส่วนที่สองชี้ไปใบหลัก", async () => {
    const placed = await placeSlip(f.actors.AGENT1, {
      title: "ลูกค้าหลายหวย",
      parts: [
        { drawId: lao, items: [bet(pt[101]!, "123", "10")] },
        { drawId: laoSet, items: [bet(pt[201]!, "1234", "30")] },
      ],
    });

    expect(placed.bills).toHaveLength(2);
    const bills = await prisma.bill.findMany({ where: { id: { in: placed.bills.map((row) => row.billId) } }, orderBy: { createdAt: "asc" } });
    const [primary, secondary] = bills;
    expect(primary!.drawId).toBe(lao);
    expect(secondary!.drawId).toBe(laoSet);
    expect(primary!.slipId).toBeNull();
    expect(secondary!.slipId).toBe(primary!.id);
    expect(placed.slipId).toBe(primary!.id);
    // เลขบิลที่ผู้ใช้เห็นเป็นเลขเดียวกัน ตัวนับเดินแค่ครั้งเดียว
    expect(primary!.drawSequence).toBe(1);
    expect(secondary!.drawSequence).toBe(1);
    expect(bills.every((bill) => bill.status === "CONFIRMED" && bill.title === "ลูกค้าหลายหวย")).toBe(true);
    // เลขภายในยังแยกตามประเภทหวย
    expect(primary!.billNumber).not.toBe(secondary!.billNumber);

    const next = await placeBill(f.actors.AGENT1, { drawId: lao, title: "ใบถัดไป", items: [bet(pt[101]!, "456", "10")] });
    expect(next.drawSequence).toBe(2);
  });

  test("หวยรัฐบาล + หวยลาว ในบิลเดียว", async () => {
    const placed = await placeSlip(f.actors.AGENT1, {
      title: "รัฐบาลกับลาว",
      parts: [
        { drawId: f.draw.id, items: [bet(f.prizeTypes.threeTop.id, "777", "20")] },
        { drawId: lao, items: [bet(pt[101]!, "777", "20")] },
      ],
    });
    const bills = await prisma.bill.findMany({ where: { id: { in: placed.bills.map((row) => row.billId) } } });
    expect(new Set(bills.map((bill) => bill.drawSequence))).toEqual(new Set([1]));
    expect(bills.map((bill) => bill.totalStake.toFixed(2)).sort()).toEqual(["20.00", "20.00"]);
  });

  test("หวยรัฐบาล + หวยลาว + หวยลาวชุด อยู่ในบิลเดียวและเลขบิลเดียวกัน", async () => {
    const placed = await placeSlip(f.actors.AGENT1, {
      title: "ครบทุกประเภทหวย",
      parts: [
        { drawId: f.draw.id, items: [bet(f.prizeTypes.threeTop.id, "789", "20")] },
        { drawId: lao, items: [bet(pt[101]!, "789", "20")] },
        { drawId: laoSet, items: [bet(pt[201]!, "6789", "30")] },
      ],
    });

    expect(placed.bills).toHaveLength(3);
    const bills = await prisma.bill.findMany({
      where: { id: { in: placed.bills.map((row) => row.billId) } },
      orderBy: { createdAt: "asc" },
      include: { draw: { select: { lotteryType: true } } },
    });
    expect(new Set(bills.map((bill) => bill.draw.lotteryType))).toEqual(new Set(["THAI_GOVERNMENT", "LAO", "LAO_SET"]));
    expect(new Set(bills.map((bill) => bill.drawSequence))).toEqual(new Set([1]));
    expect(bills[0]!.slipId).toBeNull();
    expect(bills.slice(1).every((bill) => bill.slipId === bills[0]!.id)).toBe(true);
    expect(bills.reduce((sum, bill) => sum + Number(bill.totalStake), 0)).toBe(70);

    const history = await listBetBills(f.actors.AGENT1, { tab: "ALL", pageSize: 5 });
    expect(history.total).toBe(1);
    expect(history.counts.ALL).toBe(1);
    expect(history.bills).toHaveLength(1);
    expect(history.bills[0]!.id).toBe(placed.slipId);
    expect(history.bills[0]!.parts).toHaveLength(3);
    expect(new Set(history.bills[0]!.parts.map((part) => part.draw.lotteryType))).toEqual(new Set(["THAI_GOVERNMENT", "LAO", "LAO_SET"]));
    expect(history.bills[0]!.totalStake.toFixed(2)).toBe("70.00");
    expect(history.bills[0]!._count.items).toBe(3);
    const exported = await exportBetBills(f.actors.AGENT1, { tab: "ALL" });
    expect(exported).toHaveLength(1);
    expect(exported[0]!.parts).toHaveLength(3);

    const thaiOnly = await listBetBills(f.actors.AGENT1, { tab: "ALL", lotteryType: "THAI_GOVERNMENT" });
    expect(thaiOnly.total).toBe(1);
    expect(thaiOnly.bills[0]!.parts).toHaveLength(3);
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ใบถัดไป", items: [bet(f.prizeTypes.threeTop.id, "456", "10")] });
    const pageOne = await listBetBills(f.actors.AGENT1, { tab: "ALL", page: 1, pageSize: 1 });
    const pageTwo = await listBetBills(f.actors.AGENT1, { tab: "ALL", page: 2, pageSize: 1 });
    expect(pageOne.total).toBe(2);
    expect(pageOne.pageCount).toBe(2);
    expect(pageOne.bills[0]!.id).not.toBe(pageTwo.bills[0]!.id);

    await prisma.bill.update({ where: { id: bills[0]!.id }, data: { status: "SETTLED", totalPayout: "100" } });
    const wonHistory = await listBetBills(f.actors.AGENT1, { tab: "WON" });
    expect(wonHistory.total).toBe(1);
    expect(wonHistory.bills[0]!.id).toBe(placed.slipId);
    expect(wonHistory.bills[0]!.totalPayout.toFixed(2)).toBe("100.00");
    expect(wonHistory.bills[0]!.parts).toHaveLength(3);
  });

  test("ประเภทรางวัลต้องตรงกับงวดของส่วนนั้น ใส่รางวัลหวยลาวในงวดหวยรัฐบาลไม่ได้", async () => {
    await expect(placeSlip(f.actors.AGENT1, {
      title: "ผิดงวด",
      parts: [{ drawId: f.draw.id, items: [bet(pt[101]!, "123", "10")] }],
    })).rejects.toThrow();
    expect(await prisma.bill.count()).toBe(0);
  });

  test("เลขเต็มในส่วนใดส่วนหนึ่ง: ทั้งบิลไม่ถูกสร้าง และบอกเลขที่รับไม่ได้", async () => {
    await addRestriction(f.actors.ADMIN, { drawId: laoSet, prizeTypeId: pt[201]!, number: "9999", kind: "CLOSED" });
    const error = await placeSlip(f.actors.AGENT1, {
      title: "ลูกค้า",
      parts: [
        { drawId: lao, items: [bet(pt[101]!, "123", "10")] },
        { drawId: laoSet, items: [bet(pt[201]!, "9999", "30")] },
      ],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BillItemsRejectedError);
    expect((error as BillItemsRejectedError).rejected).toEqual([expect.objectContaining({ prizeTypeId: pt[201], number: "9999" })]);
    expect(await prisma.bill.count()).toBe(0);
    // ไม่มีการออกเลขบิลค้างไว้ บิลถัดไปยังเป็นบิล 1
    const next = await placeBill(f.actors.AGENT1, { drawId: lao, title: "ใบถัดไป", items: [bet(pt[101]!, "456", "10")] });
    expect(next.drawSequence).toBe(1);
  });

  test("ส่งซ้ำด้วยรหัสเดิมได้บิลเดิมทุกส่วน ไม่สร้างเพิ่ม", async () => {
    const input = {
      title: "กดซ้ำ",
      submissionKey: "slip-key-0123456789abcdef",
      parts: [
        { drawId: lao, items: [bet(pt[101]!, "123", "10")] },
        { drawId: laoSet, items: [bet(pt[201]!, "1234", "30")] },
      ],
    };
    const first = await placeSlip(f.actors.AGENT1, input);
    const again = await placeSlip(f.actors.AGENT1, input);

    expect(again.duplicate).toBe(true);
    expect(again.bills.map((row) => row.billId)).toEqual(first.bills.map((row) => row.billId));
    expect(again.slipId).toBe(first.slipId);
    expect(await prisma.bill.count()).toBe(2);
  });
});

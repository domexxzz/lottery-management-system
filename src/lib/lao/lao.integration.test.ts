import { beforeEach, describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { placeBill, updateBillBeforeCutoff } from "@/lib/bills/service";
import { lockDrawManually, lockDueDraws } from "@/lib/draws/service";
import { toBangkokDateTimeLocal } from "@/lib/draws/schedule";
import { approveSettlement, calculateSettlement } from "@/lib/settlement/service";
import { LAO_PRIZE_TYPES } from "./rules";
import { createLaoDraws, enterLaoResult, removeCapOverride, setCapOverride } from "./service";

let f: Fixtures;
let lao: { id: string };
let laoSet: { id: string };
let pt: Record<number, string>;

/** วันจันทร์–ศุกร์ถัดไป (ในอนาคตเสมอ) รูปแบบ YYYY-MM-DD */
function nextWeekday(offsetDays = 0): string {
  const date = new Date(Date.now() + (7 + offsetDays) * 86_400_000);
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
  lao = { id: drawIds[0]! };
  laoSet = { id: drawIds[1]! };
});

const bet = (code: number, number: string, stake: string) => ({ prizeTypeId: pt[code]!, number, stake });

describe("สร้างงวดหวยลาว", () => {
  test("สร้างหวยลาวและหวยลาวชุดของวันเดียวกัน สร้างซ้ำไม่ได้ วันอื่นและเวลาออกผลแก้ได้", async () => {
    const draws = await prisma.draw.findMany({ where: { id: { in: [lao.id, laoSet.id] } }, orderBy: { lotteryType: "asc" } });
    expect(draws.map((draw) => draw.lotteryType)).toEqual(["LAO", "LAO_SET"]);
    expect(draws[0]!.laoFamilyId).toBeTruthy();
    expect(draws[1]!.laoFamilyId).toBe(draws[0]!.laoFamilyId);
    expect(draws[0]!.name).toMatch(/^หวยลาว /);
    expect(draws[1]!.name).toMatch(/^หวยลาวชุด /);
    const sameDay = draws[0]!.drawDate!.toISOString().slice(0, 10);
    // สร้างซ้ำวันเดียวกันได้ ระบบแจ้งว่าเป็นงวดซ้ำ
    const again = await createLaoDraws(f.actors.ADMIN, { drawDate: sameDay, opensAt: `${sameDay}T10:00`, cutoffAt: `${sameDay}T20:00`, lotteryTypes: ["LAO"] });
    expect(again.duplicates).toEqual(["หวยลาว"]);
    expect((await prisma.draw.findUniqueOrThrow({ where: { id: again.drawIds[0]! } })).laoFamilyId).toBeNull();
    expect(await prisma.draw.count({ where: { drawDate: draws[0]!.drawDate, lotteryType: "LAO" } })).toBe(2);
    // ค่าเริ่มต้นออกผล 20:30 น. ของวันงวด
    expect(draws[0]!.resultAt?.toISOString().slice(11, 16)).toBe("13:30");
    // วันเสาร์ก็สร้างได้ (เลื่อนวัน) และแก้เวลาออกผลได้ แต่ต้องไม่ก่อนปิดรับ
    const weekend = await createLaoDraws(f.actors.ADMIN, { drawDate: "2026-11-21", opensAt: "2026-11-21T10:00", cutoffAt: "2026-11-21T20:00", resultAt: "2026-11-21T21:15", lotteryTypes: ["LAO"] });
    const saturday = await prisma.draw.findUniqueOrThrow({ where: { id: weekend.drawIds[0]! } });
    expect(saturday.resultAt?.toISOString()).toBe("2026-11-21T14:15:00.000Z");
    await expect(createLaoDraws(f.actors.ADMIN, { drawDate: "2026-11-23", opensAt: "2026-11-23T10:00", cutoffAt: "2026-11-23T20:00", resultAt: "2026-11-23T19:00", lotteryTypes: ["LAO"] }))
      .rejects.toThrow(/ไม่ก่อนเวลาปิดรับ/);
    await expect(createLaoDraws(f.actors.AGENT1, { drawDate: nextWeekday(7), opensAt: "2030-01-01T10:00", cutoffAt: "2030-01-01T20:00", lotteryTypes: ["LAO"] }))
      .rejects.toThrow();
  });

  test("งานปิดรับอัตโนมัติปิดคู่งวดพร้อมกันเพียงครั้งเดียว", async () => {
    const outcome = await lockDueDraws(new Date(Date.now() + 2 * 3_600_000));
    const statuses = await prisma.draw.findMany({
      where: { id: { in: [lao.id, laoSet.id] } },
      select: { status: true },
    });
    expect(statuses.map((draw) => draw.status).sort()).toEqual(["LOCKED", "LOCKED"]);
    expect(outcome.locked.filter((row) => row.drawName.includes("หวยลาว")).length).toBe(1);
    expect(outcome.failed).toEqual([]);
  });
});

describe("รับบิลหวยลาว", () => {
  test("หวยลาวแทงได้ทุกเลข แต่ใช้รางวัลหวยไทยในงวดหวยลาวไม่ได้ และเลขบิลมีรหัสหวยลาว", async () => {
    const placed = await placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ก", items: [bet(101, "123", "10"), bet(104, "99", "5")] });
    expect(placed.billNumber).toMatch(/^A00102\d{6}0001$/);
    await expect(placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ข", items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }] }))
      .rejects.toThrow(/ไม่พบประเภทรางวัล|ประเภทรางวัล/);
  });

  test("หวยลาวชุดแทงเลขชุด 4 หลักได้เพียงประเภทเดียว แต่ซื้อชุด 30/60/120 ในบิลเดียวได้", async () => {
    const placed = await placeBill(f.actors.AGENT1, {
      drawId: laoSet.id,
      title: "ก",
      items: [
        bet(201, "1234", "30"), bet(201, "1234", "60"), bet(201, "1234", "120"),
      ],
    });
    expect(placed.billNumber).toMatch(/^A00103\d{6}0001$/);
    const packageItems = await prisma.billItem.findMany({ where: { billId: placed.billId, prizeTypeId: pt[201] }, orderBy: { stake: "asc" } });
    expect(packageItems.map((item) => item.stake.toFixed(0))).toEqual(["30", "60", "120"]);
    await expect(placeBill(f.actors.AGENT1, { drawId: laoSet.id, title: "ประเภทเดิม", items: [bet(202, "123", "5")] }))
      .rejects.toThrow(/ประเภทรางวัล/);
    await expect(placeBill(f.actors.AGENT1, { drawId: laoSet.id, title: "โต๊ดแยกไม่ได้แล้ว", items: [bet(203, "2143", "60")] }))
      .rejects.toThrow(/ประเภทรางวัล/);
    await expect(placeBill(f.actors.AGENT1, { drawId: laoSet.id, title: "ราคาอื่น", items: [bet(201, "9999", "50")] }))
      .rejects.toThrow(/30 \/ 60 \/ 120/);
    // รางวัลของหวยลาว (101) ใช้ในงวดหวยลาวชุดไม่ได้ และกลับกัน
    await expect(placeBill(f.actors.AGENT1, { drawId: laoSet.id, title: "ข", items: [bet(101, "123", "5")] })).rejects.toThrow(/ประเภทรางวัล/);
    await expect(placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ค", items: [bet(201, "1234", "5")] })).rejects.toThrow(/ประเภทรางวัล/);
  });

  test("หวยลาวชุดเปิดใช้แค่รหัส 201", async () => {
    const activeCodes = (await prisma.prizeType.findMany({
      where: { organizationId: f.org.id, lotteryType: "LAO_SET", isActive: true },
      orderBy: { code: "asc" },
      select: { code: true },
    })).map((row) => row.code);
    expect(activeCodes).toEqual([201]);
  });

  test("หวยลาวชุดแก้เลขได้ แต่เปลี่ยนประเภทชุด 30/60/120 หรือประเภทเลขชุดไม่ได้", async () => {
    const placed = await placeBill(f.actors.AGENT1, {
      drawId: laoSet.id,
      title: "ชุด 30",
      items: [bet(201, "1234", "30")],
    });
    await updateBillBeforeCutoff(f.actors.AGENT1, placed.billId, {
      title: "ชุด 30 แก้เลข",
      items: [bet(201, "4321", "30")],
    });
    await expect(updateBillBeforeCutoff(f.actors.AGENT1, placed.billId, {
      title: "พยายามเปลี่ยนเป็นชุด 60",
      items: [bet(201, "4321", "60")],
    })).rejects.toThrow(/ประเภทชุด 30\/60\/120/);
    await expect(updateBillBeforeCutoff(f.actors.AGENT1, placed.billId, {
      title: "พยายามเปลี่ยนเป็นโต๊ด",
      items: [bet(203, "4321", "30")],
    })).rejects.toThrow(/ประเภทตรง\/โต๊ดแก้ไม่ได้/);
  });

  test("เพดาน 2,000 แยกตามประเภท และ Owner ตั้งเพดานเฉพาะเลขได้ (Admin ตั้งไม่ได้)", async () => {
    await placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ก", items: [bet(101, "441", "1000")] });
    await placeBill(f.actors.AGENT2, { drawId: lao.id, title: "ข", items: [bet(101, "441", "1000")] });
    await expect(placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ค", items: [bet(101, "441", "5")] })).rejects.toThrow(/เลขเต็ม/);
    // คนละประเภท (3 ตัวโต๊ด) ยังแทงได้ และเลขสลับของ 3 ตัวตรงเป็นคนละเลข
    await placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ง", items: [bet(102, "441", "5"), bet(101, "414", "5")] });

    await expect(setCapOverride(f.actors.ADMIN, { drawId: lao.id, prizeTypeId: pt[101]!, number: "441", cap: "3000" })).rejects.toThrow();
    await setCapOverride(f.actors.OWNER, { drawId: lao.id, prizeTypeId: pt[101]!, number: "441", cap: "3000" });
    await placeBill(f.actors.AGENT1, { drawId: lao.id, title: "จ", items: [bet(101, "441", "1000")] });
    await expect(placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ฉ", items: [bet(101, "441", "5")] })).rejects.toThrow(/เลขเต็ม/);

    // ลดเพดานเฉพาะเลขลงได้ด้วย
    await setCapOverride(f.actors.OWNER, { drawId: lao.id, prizeTypeId: pt[103]!, number: "41", cap: "10" });
    await expect(placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ช", items: [bet(103, "41", "20")] })).rejects.toThrow(/รับได้อีก 10 บาท/);
    const override = await prisma.numberCapOverride.findFirstOrThrow({ where: { drawId: lao.id, number: "41" } });
    await removeCapOverride(f.actors.OWNER, override.id);
    await placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ซ", items: [bet(103, "41", "20")] });
  });
});

describe("ลงผล 489441 (งวด 17 พ.ย. 2569) และคำนวณเงิน", () => {
  test("ลงผลครั้งเดียวได้ทั้งสองงวด และเลขชุดรวมจ่ายทุกรางวัลที่เข้าเงื่อนไข", async () => {
    await placeBill(f.actors.AGENT1, {
      drawId: lao.id,
      title: "หวยลาว",
      items: [bet(101, "441", "10"), bet(102, "144", "10"), bet(103, "41", "10"), bet(104, "94", "10"), bet(104, "41", "10")],
    });
    await placeBill(f.actors.AGENT1, {
      drawId: laoSet.id,
      title: "หวยลาวชุด",
      items: [
        bet(201, "9441", "30"), // เข้าเงื่อนไขครบ 8 รางวัล รวม 39,350
        bet(201, "4194", "30"), // 4 ตัวโต๊ด 1,125
        bet(201, "0441", "30"), // 3 ตัวท้ายตรง 9,250
        bet(201, "0144", "30"), // 3 ตัวท้ายโต๊ด 925
        bet(201, "9442", "30"), // 3 ตัวหน้าตรง 1,425
        bet(201, "4942", "30"), // 3 ตัวหน้าโต๊ด 425
        bet(201, "9412", "30"), // 2 ตัวหน้า 350
        bet(201, "0041", "30"), // 2 ตัวหลัง 350
        bet(201, "1234", "30"), // ไม่ถูก
      ],
    });

    await lockDrawManually(f.actors.ADMIN, lao.id);
    expect((await prisma.draw.findMany({
      where: { id: { in: [lao.id, laoSet.id] } },
      orderBy: { id: "asc" },
      select: { status: true },
    })).map((draw) => draw.status)).toEqual(["LOCKED", "LOCKED"]);
    await expect(enterLaoResult(f.actors.ADMIN, lao.id, "48a441")).rejects.toThrow(/ตัวเลข/);
    const entered = await enterLaoResult(f.actors.ADMIN, lao.id, "489441");
    expect(entered.saved.map((row) => row.drawId).sort()).toEqual([lao.id, laoSet.id].sort());
    await expect(enterLaoResult(f.actors.ADMIN, laoSet.id, "489441")).rejects.toThrow(/มีผลแล้ว/);

    const results = await prisma.result.findMany({ where: { drawId: { in: [lao.id, laoSet.id] } }, include: { prizeType: { select: { code: true } } } });
    const valueOf = Object.fromEntries(results.map((row) => [row.prizeType.code, row.value]));
    expect(valueOf).toEqual({ 101: "441", 102: "441", 103: "41", 104: "94", 201: "9441" });
    expect((await prisma.draw.findUniqueOrThrow({ where: { id: laoSet.id } })).officialNumber).toBe("489441");

    const [laoPreview] = await calculateSettlement(f.actors.ADMIN, lao.id);
    // 441×650 + โต๊ด 144×100 + 41×75 + 94×75 (ล่าง 41 ไม่ถูก)
    expect(laoPreview!.payout.toFixed(2)).toBe((10 * 650 + 10 * 100 + 10 * 75 + 10 * 75).toFixed(2));
    expect(laoPreview!.winningItems).toBe(4);

    const [setPreview] = await calculateSettlement(f.actors.ADMIN, laoSet.id);
    expect(setPreview!.payout.toFixed(2)).toBe("55250.00");
    expect(setPreview!.winningItems).toBe(19);
    expect(setPreview!.gross.toFixed(2)).toBe("270.00");
    const setItems = await prisma.billItem.findMany({
      where: { bill: { drawId: laoSet.id } },
      select: { number: true, payout: true, isWinner: true },
    });
    expect(Object.fromEntries(setItems.map((item) => [item.number, { payout: Number(item.payout), isWinner: item.isWinner }]))).toEqual({
      "9441": { payout: 39_350, isWinner: true },
      "4194": { payout: 1_125, isWinner: true },
      "0441": { payout: 10_525, isWinner: true },
      "0144": { payout: 925, isWinner: true },
      "9442": { payout: 2_200, isWinner: true },
      "4942": { payout: 425, isWinner: true },
      "9412": { payout: 350, isWinner: true },
      "0041": { payout: 350, isWinner: true },
      "1234": { payout: 0, isWinner: false },
    });
    expect(await prisma.billItemWinningPrize.count({ where: { billItem: { bill: { drawId: laoSet.id } } } })).toBe(19);
  });

  test("ตัวอย่างเลข 1234 ผล 561234 จ่ายครบ 8 รางวัลและคำนวณซ้ำไม่สร้าง ledger ซ้ำ", async () => {
    await placeBill(f.actors.AGENT1, { drawId: laoSet.id, title: "ก", items: [bet(201, "1234", "30")] });
    await lockDrawManually(f.actors.ADMIN, laoSet.id);
    await enterLaoResult(f.actors.ADMIN, laoSet.id, "561234");
    const [preview] = await calculateSettlement(f.actors.ADMIN, laoSet.id);
    expect(preview!.payout.toFixed(2)).toBe("39350.00");
    expect(preview!.winningItems).toBe(8);
    const item = await prisma.billItem.findFirstOrThrow({ where: { bill: { drawId: laoSet.id } } });
    expect(item.payout.toFixed(2)).toBe("39350.00");
    expect(await prisma.billItemWinningPrize.count({ where: { billItemId: item.id } })).toBe(8);
    const [recalculated] = await calculateSettlement(f.actors.ADMIN, laoSet.id);
    expect(recalculated!.payout.toFixed(2)).toBe("39350.00");
    expect(await prisma.billItemWinningPrize.count({ where: { billItemId: item.id } })).toBe(8);
  });

  test("เลขเดียวกันชุด 30/60/120 ถูกตรง จ่ายแยกครบทั้งสามรายการ", async () => {
    await placeBill(f.actors.AGENT1, {
      drawId: laoSet.id,
      title: "สามราคาชุด",
      items: [bet(201, "9441", "30"), bet(201, "9441", "60"), bet(201, "9441", "120")],
    });
    await lockDrawManually(f.actors.ADMIN, laoSet.id);
    await enterLaoResult(f.actors.ADMIN, laoSet.id, "489441");
    const [preview] = await calculateSettlement(f.actors.ADMIN, laoSet.id);
    expect(preview!.payout.toFixed(2)).toBe("275450.00");
    expect(preview!.winningItems).toBe(24);
  });

  test("งวดเดี่ยววันเดียวกันไม่ถูกปิดหรือบันทึกผลตามคู่งวด", async () => {
    const paired = await prisma.draw.findUniqueOrThrow({ where: { id: lao.id }, select: { drawDate: true } });
    const sameDay = paired.drawDate!.toISOString().slice(0, 10);
    const standalone = await createLaoDraws(f.actors.ADMIN, {
      drawDate: sameDay,
      opensAt: `${sameDay}T10:00`,
      cutoffAt: `${sameDay}T20:00`,
      lotteryTypes: ["LAO"],
    });
    const standaloneId = standalone.drawIds[0]!;

    await lockDrawManually(f.actors.ADMIN, laoSet.id);
    expect((await prisma.draw.findUniqueOrThrow({ where: { id: standaloneId } })).status).toBe("OPEN");

    await enterLaoResult(f.actors.ADMIN, lao.id, "489441");
    expect(await prisma.result.count({ where: { drawId: standaloneId } })).toBe(0);
  });

  test("บิลเก่าที่ใช้รางวัลลาวชุดซึ่งปิดใช้งานแล้ว ไม่ขวางการบันทึกผลให้คู่งวด", async () => {
    const placed = await placeBill(f.actors.AGENT1, {
      drawId: laoSet.id,
      title: "บิลเก่า",
      items: [bet(201, "9441", "30")],
    });
    await prisma.billItem.create({
      data: {
        organizationId: f.org.id,
        billId: placed.billId,
        prizeTypeId: pt[206]!,
        number: "94",
        stake: new Prisma.Decimal(5),
        payoutRateSnapshot: new Prisma.Decimal(500),
      },
    });
    await lockDrawManually(f.actors.ADMIN, lao.id);

    const entered = await enterLaoResult(f.actors.ADMIN, lao.id, "489441");
    expect(entered.saved.map((row) => row.drawId).sort()).toEqual([lao.id, laoSet.id].sort());
    expect(await prisma.result.count({ where: { drawId: laoSet.id, prizeTypeId: pt[206] } })).toBe(1);
  });

  test("คำนวณและปิดบัญชีจากฝั่งเดียว เปลี่ยนสถานะคู่งวดพร้อมกัน", async () => {
    await placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ลาว", items: [bet(101, "441", "10")] });
    await lockDrawManually(f.actors.ADMIN, laoSet.id);
    await enterLaoResult(f.actors.ADMIN, lao.id, "489441");

    await calculateSettlement(f.actors.ADMIN, lao.id);
    expect((await prisma.draw.findMany({ where: { id: { in: [lao.id, laoSet.id] } }, select: { status: true } }))
      .map((draw) => draw.status).sort()).toEqual(["SETTLED", "SETTLED"]);

    await approveSettlement(f.actors.OWNER, laoSet.id);
    expect((await prisma.draw.findMany({ where: { id: { in: [lao.id, laoSet.id] } }, select: { status: true } }))
      .map((draw) => draw.status).sort()).toEqual(["CLOSED", "CLOSED"]);
  });
});

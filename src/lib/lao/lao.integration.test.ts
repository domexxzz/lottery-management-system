import { beforeEach, describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { placeBill } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { toBangkokDateTimeLocal } from "@/lib/draws/schedule";
import { calculateSettlement } from "@/lib/settlement/service";
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
    expect(draws[0]!.name).toMatch(/^หวยลาว /);
    expect(draws[1]!.name).toMatch(/^หวยลาวชุด /);
    const sameDay = draws[0]!.drawDate!.toISOString().slice(0, 10);
    // สร้างซ้ำวันเดียวกันได้ ระบบแจ้งว่าเป็นงวดซ้ำ
    const again = await createLaoDraws(f.actors.ADMIN, { drawDate: sameDay, opensAt: `${sameDay}T10:00`, cutoffAt: `${sameDay}T20:00`, lotteryTypes: ["LAO"] });
    expect(again.duplicates).toEqual(["หวยลาว"]);
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
});

describe("รับบิลหวยลาว", () => {
  test("หวยลาวแทงได้ทุกเลข แต่ใช้รางวัลหวยไทยในงวดหวยลาวไม่ได้ และเลขบิลมีรหัสหวยลาว", async () => {
    const placed = await placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ก", items: [bet(101, "123", "10"), bet(104, "99", "5")] });
    expect(placed.billNumber).toMatch(/^A00102\d{6}0001$/);
    await expect(placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ข", items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }] }))
      .rejects.toThrow(/ไม่พบประเภทรางวัล|ประเภทรางวัล/);
  });

  test("หวยลาวชุดแทงได้ทุกเลขทุกประเภททันที ไม่ต้องเปิดเลขก่อน และใช้รางวัลหวยลาวผิดงวดไม่ได้", async () => {
    const placed = await placeBill(f.actors.AGENT1, {
      drawId: laoSet.id,
      title: "ก",
      items: [bet(201, "1234", "5"), bet(203, "2143", "5"), bet(206, "12", "5"), bet(207, "34", "5")],
    });
    expect(placed.billNumber).toMatch(/^A00103\d{6}0001$/);
    // รางวัลของหวยลาว (101) ใช้ในงวดหวยลาวชุดไม่ได้ และกลับกัน
    await expect(placeBill(f.actors.AGENT1, { drawId: laoSet.id, title: "ข", items: [bet(101, "123", "5")] })).rejects.toThrow(/ประเภทรางวัล/);
    await expect(placeBill(f.actors.AGENT1, { drawId: lao.id, title: "ค", items: [bet(201, "1234", "5")] })).rejects.toThrow(/ประเภทรางวัล/);
  });

  test("หวยลาวชุดใช้ชื่อ 2 ตัวบน / 2 ตัวล่าง", async () => {
    const names = (await prisma.prizeType.findMany({ where: { organizationId: f.org.id, code: { in: [206, 207] } }, orderBy: { code: "asc" } })).map((row) => row.name);
    expect(names).toEqual(["2 ตัวล่าง", "2 ตัวบน"]);
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
  test("ลงผลครั้งเดียวได้ทั้งสองงวด จ่ายเฉพาะประเภทที่แทง ถูกหลายประเภทได้รวม", async () => {
    await placeBill(f.actors.AGENT1, {
      drawId: lao.id,
      title: "หวยลาว",
      items: [bet(101, "441", "10"), bet(102, "144", "10"), bet(103, "41", "10"), bet(104, "94", "10"), bet(104, "41", "10")],
    });
    await placeBill(f.actors.AGENT1, {
      drawId: laoSet.id,
      title: "หวยลาวชุด",
      items: [
        bet(201, "9441", "5"), bet(202, "441", "5"), bet(203, "4194", "5"), bet(204, "414", "5"),
        bet(205, "944", "5"), bet(206, "94", "5"), bet(207, "41", "5"), bet(201, "1234", "5"),
      ],
    });

    await lockDrawManually(f.actors.ADMIN, lao.id);
    await lockDrawManually(f.actors.ADMIN, laoSet.id);
    await expect(enterLaoResult(f.actors.ADMIN, lao.id, "48a441")).rejects.toThrow(/ตัวเลข/);
    const entered = await enterLaoResult(f.actors.ADMIN, lao.id, "489441");
    expect(entered.saved.map((row) => row.drawId).sort()).toEqual([lao.id, laoSet.id].sort());
    await expect(enterLaoResult(f.actors.ADMIN, laoSet.id, "489441")).rejects.toThrow(/มีผลแล้ว/);

    const results = await prisma.result.findMany({ where: { drawId: { in: [lao.id, laoSet.id] } }, include: { prizeType: { select: { code: true } } } });
    const valueOf = Object.fromEntries(results.map((row) => [row.prizeType.code, row.value]));
    expect(valueOf).toEqual({ 101: "441", 102: "441", 103: "41", 104: "94", 201: "9441", 202: "441", 203: "9441", 204: "441", 205: "944", 206: "94", 207: "41" });
    expect((await prisma.draw.findUniqueOrThrow({ where: { id: laoSet.id } })).officialNumber).toBe("489441");

    const [laoPreview] = await calculateSettlement(f.actors.ADMIN, lao.id);
    // 441×650 + โต๊ด 144×100 + 41×75 + 94×75 (ล่าง 41 ไม่ถูก)
    expect(laoPreview!.payout.toFixed(2)).toBe((10 * 650 + 10 * 100 + 10 * 75 + 10 * 75).toFixed(2));
    expect(laoPreview!.winningItems).toBe(4);

    const [setPreview] = await calculateSettlement(f.actors.ADMIN, laoSet.id);
    // ทุกประเภทที่แทงไว้ถูกหมด ได้รวม ส่วน 4 ตัวตรง 1234 ไม่ถูก
    expect(setPreview!.payout.toFixed(2)).toBe((5 * (50000 + 17000 + 2000 + 1250 + 600 + 500 + 500)).toFixed(2));
    expect(setPreview!.winningItems).toBe(7);
    expect(setPreview!.gross.toFixed(2)).toBe("40.00");
  });

  test("ได้เฉพาะที่แทง: แทง 4 ตัวตรงอย่างเดียว ผลตรงก็ไม่ได้ 4 ตัวโต๊ดเพิ่ม", async () => {
    await placeBill(f.actors.AGENT1, { drawId: laoSet.id, title: "ก", items: [bet(201, "9441", "20")] });
    await lockDrawManually(f.actors.ADMIN, laoSet.id);
    await enterLaoResult(f.actors.ADMIN, laoSet.id, "489441");
    const [preview] = await calculateSettlement(f.actors.ADMIN, laoSet.id);
    expect(preview!.payout.toFixed(2)).toBe("1000000.00"); // 20 × 50,000
  });
});

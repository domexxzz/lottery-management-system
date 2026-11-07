import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { approveResult, enterResult } from "@/lib/results/service";
import { calculateSettlement } from "@/lib/settlement/service";
import { byAgent, byPrizeType, drawSummary, searchBills } from "@/lib/reports/service";
import { sumMoney } from "@/lib/money";

/**
 * รายงานต้องตรงกับ Settlement เสมอ
 *
 * ถ้าวันหนึ่งใครแยกการคำนวณของรายงานออกจาก Settlement ตัวเลขจะเริ่มเพี้ยน
 * test ชุดนี้คือสิ่งที่จับได้
 */

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function settledDraw() {
  const { threeTop, threeTod } = f.prizeTypes;

  const b1 = await createDraftBill(f.actors.AGENT1, { drawId: f.draw.id, title: "A1 บิลหนึ่ง" });
  await replaceDraftItems(f.actors.AGENT1, b1.billId, [
    { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    { prizeTypeId: threeTod.id, number: "999", stake: "60" },
  ]);
  await confirmBill(f.actors.AGENT1, b1.billId);

  const b2 = await createDraftBill(f.actors.AGENT2, { drawId: f.draw.id, title: "A2 บิลหนึ่ง" });
  await replaceDraftItems(f.actors.AGENT2, b2.billId, [
    { prizeTypeId: threeTop.id, number: "777", stake: "40" },
  ]);
  await confirmBill(f.actors.AGENT2, b2.billId);

  await lockDrawManually(f.actors.ADMIN, f.draw.id);

  for (const v of [
    { prizeTypeId: threeTop.id, value: "123" },
    { prizeTypeId: threeTod.id, value: "123" },
  ]) {
    await enterResult(f.actors.ADMIN, { drawId: f.draw.id, ...v });
  }
  for (const d of await prisma.result.findMany({ where: { drawId: f.draw.id, status: "DRAFT" } })) {
    await approveResult(f.actors.ADMIN, d.id);
  }

  return calculateSettlement(f.actors.ADMIN, f.draw.id);
}

describe("รายงานตรงกับ Settlement", () => {
  test("Dashboard ตรงกับผลรวมของ Settlement ทุกช่อง", async () => {
    const previews = await settledDraw();
    const summary = await drawSummary(f.actors.OWNER, f.draw.id);

    expect(summary.gross.equals(sumMoney(previews.map((p) => p.gross)))).toBe(true);
    expect(summary.payout.equals(sumMoney(previews.map((p) => p.payout)))).toBe(true);
    expect(summary.commission.equals(sumMoney(previews.map((p) => p.commission)))).toBe(true);
    expect(summary.net.equals(sumMoney(previews.map((p) => p.net)))).toBe(true);
    expect(summary.pendingSettlement).toBe(false);
  });

  test("รายงานแยก Agent ตรงกับ Settlement รายราย", async () => {
    const previews = await settledDraw();
    const rows = await byAgent(f.actors.OWNER, f.draw.id);

    const bySettlement = new Map(previews.map((p) => [p.agentCode, p]));
    expect(rows).toHaveLength(previews.length);

    for (const row of rows) {
      const settlement = bySettlement.get(row.agentCode)!;
      expect(row.gross.equals(settlement.gross)).toBe(true);
      expect(row.payout.equals(settlement.payout)).toBe(true);
      expect(row.commission.equals(settlement.commission)).toBe(true);
      expect(row.net.equals(settlement.net)).toBe(true);
    }
  });

  test("ผลรวมแยกตามรางวัลตรงกับยอดรวมของรอบ", async () => {
    await settledDraw();
    const summary = await drawSummary(f.actors.OWNER, f.draw.id);
    const prizes = await byPrizeType(f.actors.OWNER, f.draw.id);

    expect(sumMoney(prizes.map((p) => p.gross)).equals(summary.gross)).toBe(true);
    expect(sumMoney(prizes.map((p) => p.payout)).equals(summary.payout)).toBe(true);
    expect(prizes.reduce((n, p) => n + p.itemCount, 0)).toBe(summary.itemCount);
  });

  test("นับจำนวนผู้ถูกรางวัลต่อประเภทได้ถูกต้อง", async () => {
    await settledDraw();
    const prizes = await byPrizeType(f.actors.OWNER, f.draw.id);
    const byCode = new Map(prizes.map((p) => [p.code, p]));

    // 3 ตัวบน: A1 แทง 123 ถูก · A2 แทง 777 ไม่ถูก
    expect(byCode.get(1)!.itemCount).toBe(2);
    expect(byCode.get(1)!.winnerCount).toBe(1);

    // 3 ตัวโต๊ด: A1 แทง 999 ไม่ใช่โต๊ดของ 123
    expect(byCode.get(2)!.winnerCount).toBe(0);
  });

  test("ตัวกรองทุกรอบรวมยอดและ Settlement ของ Agent จากหลายรอบ", async () => {
    await settledDraw();
    const firstSummary = await drawSummary(f.actors.OWNER, f.draw.id);
    const secondDraw = await prisma.draw.create({
      data: {
        organizationId: f.org.id,
        name: "งวดทดสอบรอบสอง",
        opensAt: new Date("2026-01-01T00:00:00.000Z"),
        cutoffAt: new Date("2026-01-02T00:00:00.000Z"),
        status: "CLOSED",
      },
    });
    await prisma.bill.create({
      data: {
        organizationId: f.org.id,
        agentId: f.agents.agent1.id,
        drawId: secondDraw.id,
        billNumber: "ALL-SECOND-001",
        title: "ลูกค้ารอบสอง",
        status: "SETTLED",
        totalStake: "50",
        totalPayout: "5",
        createdById: f.users.agentUser1.id,
        confirmedAt: new Date(),
      },
    });
    await prisma.settlement.create({
      data: {
        organizationId: f.org.id,
        drawId: secondDraw.id,
        agentId: f.agents.agent1.id,
        gross: "50",
        payout: "5",
        commission: "10",
        net: "35",
        commissionRateSnapshot: "20",
        status: "APPROVED",
      },
    });

    const summary = await drawSummary(f.actors.OWNER);
    const agents = await byAgent(f.actors.OWNER);
    const agent1 = agents.find((row) => row.agentId === f.agents.agent1.id)!;

    expect(summary.drawId).toBe("all");
    expect(summary.drawName).toBe("ทุกรอบ");
    expect(summary.gross.equals(firstSummary.gross.plus(50))).toBe(true);
    expect(summary.payout.equals(firstSummary.payout.plus(5))).toBe(true);
    expect(summary.commission.equals(firstSummary.commission.plus(10))).toBe(true);
    expect(summary.net.equals(firstSummary.net.plus(35))).toBe(true);
    expect(agent1.gross.greaterThanOrEqualTo(50)).toBe(true);
    expect(agent1.commission.greaterThanOrEqualTo(10)).toBe(true);
  });
});

describe("รอบที่ยังไม่คำนวณ", () => {
  test("ขึ้นสถานะรอคำนวณ และยอดจ่ายยังเป็นศูนย์", async () => {
    const { billId } = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ยังไม่คำนวณ",
    });
    await replaceDraftItems(f.actors.AGENT1, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    await confirmBill(f.actors.AGENT1, billId);

    const summary = await drawSummary(f.actors.OWNER, f.draw.id);

    expect(summary.pendingSettlement).toBe(true);
    expect(summary.gross.toFixed(2)).toBe("100.00");
    expect(summary.payout.toFixed(2)).toBe("0.00");
  });
});

describe("ค้นหาบิล", () => {
  beforeEach(async () => {
    for (const title of ["ลูกค้า สมชาย", "ลูกค้า สมหญิง"]) {
      const { billId } = await createDraftBill(f.actors.AGENT1, { drawId: f.draw.id, title });
      await replaceDraftItems(f.actors.AGENT1, billId, [
        { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" },
      ]);
      await confirmBill(f.actors.AGENT1, billId);
    }
  });

  test("ค้นตามชื่อบิลได้", async () => {
    const found = await searchBills(f.actors.ADMIN, { query: "สมชาย" });
    expect(found).toHaveLength(1);
    expect(found[0]!.title).toBe("ลูกค้า สมชาย");
  });

  test("ค้นตามเลขบิลได้", async () => {
    const all = await searchBills(f.actors.ADMIN, {});
    const target = all[0]!.billNumber!;
    const found = await searchBills(f.actors.ADMIN, { query: target });
    expect(found).toHaveLength(1);
    expect(found[0]!.billNumber).toBe(target);
  });

  test("กรองตามสถานะได้", async () => {
    expect(await searchBills(f.actors.ADMIN, { status: "CONFIRMED" })).toHaveLength(2);
    expect(await searchBills(f.actors.ADMIN, { status: "CANCELLED" })).toHaveLength(0);
  });

  test("Agent ระบุ agentId ของคนอื่นแล้วยังไม่เห็นข้อมูลคนอื่น", async () => {
    const found = await searchBills(f.actors.AGENT1, { agentId: f.agents.agent2.id });
    // ตัวกรองถูกเพิกเฉยเพราะไม่มีสิทธิ์ และ billScope ยังจำกัดที่บิลของตนเอง
    expect(found).toHaveLength(2);
    expect(found.every((b) => b.agent.code === "A001")).toBe(true);
  });
});

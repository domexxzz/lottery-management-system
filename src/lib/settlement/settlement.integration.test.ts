import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { approveResult, enterResult, proposeResultCorrection } from "@/lib/results/service";
import {
  approveSettlement,
  calculateSettlement,
} from "@/lib/settlement/service";

/**
 * เส้นทางเงินทั้งเส้น ตั้งแต่ Agent สร้างบิลจนปิดบัญชีรอบ
 *
 * test ชุดนี้คือสิ่งที่กันไม่ให้ตัวเลขเงินเพี้ยนโดยไม่มีใครรู้
 * unit test ครอบได้แค่ pure function ส่วนที่เงินไหลผ่านจริงอยู่ตรงนี้
 */

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** สร้างบิลที่ยืนยันแล้วหนึ่งใบ */
async function confirmedBill(
  actor: Fixtures["actors"]["AGENT1"],
  items: { prizeTypeId: string; number: string; stake: string }[],
  title = "บิลทดสอบ",
) {
  const { billId } = await createDraftBill(actor, { drawId: f.draw.id, title });
  await replaceDraftItems(actor, billId, items);
  const result = await confirmBill(actor, billId);
  return { billId, ...result };
}

/** ลงผลและอนุมัติครบ เพื่อให้พร้อมคำนวณ */
async function approveResults(values: { prizeTypeId: string; value: string }[]) {
  for (const v of values) {
    await enterResult(f.actors.ADMIN, { drawId: f.draw.id, ...v });
  }
  const drafts = await prisma.result.findMany({
    where: { drawId: f.draw.id, status: "DRAFT" },
  });
  for (const d of drafts) {
    await approveResult(f.actors.ADMIN, d.id);
  }
}

describe("เส้นทางเงินเต็มเส้น", () => {
  test("คำนวณถูกต้องตั้งแต่สร้างบิลจนปิดบัญชี", async () => {
    const { threeTop, threeTod, runTop } = f.prizeTypes;

    await confirmedBill(f.actors.AGENT1, [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" }, // ถูก 100×900 = 90,000
      { prizeTypeId: threeTop.id, number: "999", stake: "50" }, // ไม่ถูก
      { prizeTypeId: threeTod.id, number: "321", stake: "20" }, // โต๊ดของ 123 ถูก 20×150 = 3,000
      { prizeTypeId: runTop.id, number: "2", stake: "10" }, // 2 อยู่ใน 123 ถูก 10×3.2 = 32
      { prizeTypeId: runTop.id, number: "3", stake: "10" }, // 3 ก็อยู่ใน 123 ถูก 10×3.2 = 32
      { prizeTypeId: runTop.id, number: "4", stake: "10" }, // 4 ไม่อยู่ใน 123 ไม่ถูก
    ]);

    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([
      { prizeTypeId: threeTop.id, value: "123" },
      { prizeTypeId: threeTod.id, value: "123" },
      // ผลของวิ่งบนคือเลข 3 ตัวบนทั้งก้อน ทุกหลักในนี้ถูกรางวัล
      // เดิมด่านตรวจผลบังคับให้กรอกได้หลักเดียว ทำให้คนแทงอีกสองหลักถูกตัดทิ้ง
      { prizeTypeId: runTop.id, value: "123" },
    ]);

    const previews = await calculateSettlement(f.actors.ADMIN, f.draw.id);

    expect(previews).toHaveLength(1);
    const a1 = previews[0]!;
    expect(a1.gross.toFixed(2)).toBe("200.00");
    expect(a1.payout.toFixed(2)).toBe("93064.00"); // 90,000 + 3,000 + 32 + 32
    expect(a1.commission.toFixed(2)).toBe("50.00"); // 200 × 25%
    expect(a1.net.toFixed(2)).toBe("-92914.00");
    expect(a1.winningItems).toBe(4);
    expect(a1.totalItems).toBe(6);

    // ยืนยันรายหลักว่าวิ่งบนจ่ายทุกหลักที่อยู่ในผล ไม่ใช่หลักเดียว
    const runItems = await prisma.billItem.findMany({
      where: { prizeTypeId: runTop.id },
      select: { number: true, isWinner: true, payout: true },
      orderBy: { number: "asc" },
    });
    expect(runItems.map((i) => [i.number, i.isWinner, i.payout.toFixed(2)])).toEqual([
      ["2", true, "32.00"],
      ["3", true, "32.00"],
      ["4", false, "0.00"],
    ]);
  });

  test("แยกยอดต่อ Agent ไม่ปนกัน และใช้อัตราคอมของแต่ละราย", async () => {
    const { threeTop } = f.prizeTypes;

    await confirmedBill(f.actors.AGENT1, [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await confirmedBill(f.actors.AGENT2, [
      { prizeTypeId: threeTop.id, number: "777", stake: "40" },
    ]);

    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([{ prizeTypeId: threeTop.id, value: "123" }]);

    const previews = await calculateSettlement(f.actors.ADMIN, f.draw.id);
    const byCode = new Map(previews.map((p) => [p.agentCode, p]));

    const a1 = byCode.get("A001")!;
    expect(a1.payout.toFixed(2)).toBe("90000.00");
    expect(a1.commission.toFixed(2)).toBe("25.00"); // 100 × 25%

    const a2 = byCode.get("A002")!;
    expect(a2.payout.toFixed(2)).toBe("0.00");
    expect(a2.commission.toFixed(2)).toBe("8.00"); // 40 × 20%
    expect(a2.net.toFixed(2)).toBe("32.00");
  });

  test("คำนวณซ้ำได้ผลเดิมทุกครั้ง", async () => {
    const { threeTop } = f.prizeTypes;
    await confirmedBill(f.actors.AGENT1, [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([{ prizeTypeId: threeTop.id, value: "123" }]);

    const runs = [
      await calculateSettlement(f.actors.ADMIN, f.draw.id),
      await calculateSettlement(f.actors.ADMIN, f.draw.id),
      await calculateSettlement(f.actors.ADMIN, f.draw.id),
    ];

    const nets = runs.map((r) => r[0]!.net.toFixed(2));
    expect(nets).toEqual(["-89925.00", "-89925.00", "-89925.00"]);
  });

  test("แก้อัตราจ่ายหลังยืนยันบิลแล้ว ไม่กระทบยอดของบิลเดิม", async () => {
    const { threeTop } = f.prizeTypes;
    await confirmedBill(f.actors.AGENT1, [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);

    // เปลี่ยน rulebook หลังบิลถูกยืนยันไปแล้ว
    await prisma.prizeType.update({
      where: { id: threeTop.id },
      data: { payoutRate: "1.00" },
    });

    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([{ prizeTypeId: threeTop.id, value: "123" }]);
    const previews = await calculateSettlement(f.actors.ADMIN, f.draw.id);

    // ยังใช้ 900 ที่ล็อกไว้ตอนยืนยัน ไม่ใช่ 1.00 ที่เพิ่งแก้
    expect(previews[0]!.payout.toFixed(2)).toBe("90000.00");
  });

  test("บิลที่ยกเลิกไม่ถูกนับเข้ายอด", async () => {
    const { threeTop } = f.prizeTypes;
    const keep = await confirmedBill(
      f.actors.AGENT1,
      [{ prizeTypeId: threeTop.id, number: "123", stake: "100" }],
      "เก็บไว้",
    );
    const drop = await confirmedBill(
      f.actors.AGENT1,
      [{ prizeTypeId: threeTop.id, number: "123", stake: "500" }],
      "ยกเลิก",
    );

    const { cancelBill } = await import("@/lib/bills/service");
    await cancelBill(f.actors.ADMIN, drop.billId, "ทดสอบว่าไม่ถูกนับ");

    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([{ prizeTypeId: threeTop.id, value: "123" }]);
    const previews = await calculateSettlement(f.actors.ADMIN, f.draw.id);

    expect(previews[0]!.gross.toFixed(2)).toBe("100.00");
    expect(previews[0]!.payout.toFixed(2)).toBe("90000.00");
    expect(keep.billNumber).not.toBe(drop.billNumber);
  });

  test("ผลที่ยังไม่อนุมัติไม่ถูกนำมาคำนวณ", async () => {
    const { threeTop } = f.prizeTypes;
    await confirmedBill(f.actors.AGENT1, [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await lockDrawManually(f.actors.ADMIN, f.draw.id);

    // จำลอง DRAFT ที่ค้างจากระบบ Maker-Checker เวอร์ชันเดิม
    await prisma.result.create({
      data: {
        organizationId: f.org.id,
        drawId: f.draw.id,
        prizeTypeId: threeTop.id,
        value: "123",
        makerId: f.users.admin.id,
        status: "DRAFT",
      },
    });

    await expect(calculateSettlement(f.actors.ADMIN, f.draw.id)).rejects.toThrow(
      /ยังไม่มีผลรางวัลที่อนุมัติ/,
    );
  });
});

describe("ปิดบัญชีรอบ", () => {
  async function readyToClose() {
    const { threeTop } = f.prizeTypes;
    await confirmedBill(f.actors.AGENT1, [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([{ prizeTypeId: threeTop.id, value: "123" }]);
    await calculateSettlement(f.actors.ADMIN, f.draw.id);
  }

  test("คำนวณ Settlement แล้ว Owner ปิดบัญชีได้ทันที", async () => {
    await readyToClose();
    await approveSettlement(f.actors.OWNER, f.draw.id);
    expect((await prisma.draw.findUniqueOrThrow({ where: { id: f.draw.id } })).status).toBe("CLOSED");
  });

  test("ปิดบัญชีแล้วรอบและบิลเปลี่ยนสถานะ และคำนวณซ้ำไม่ได้อีก", async () => {
    await readyToClose();

    await approveSettlement(f.actors.OWNER, f.draw.id);

    const draw = await prisma.draw.findUniqueOrThrow({ where: { id: f.draw.id } });
    const bills = await prisma.bill.findMany({ where: { drawId: f.draw.id } });
    const settlements = await prisma.settlement.findMany({ where: { drawId: f.draw.id } });

    expect(draw.status).toBe("CLOSED");
    expect(draw.closedAt).not.toBeNull();
    expect(bills.every((b) => b.status === "SETTLED")).toBe(true);
    expect(settlements.every((s) => s.status === "APPROVED")).toBe(true);

    await expect(calculateSettlement(f.actors.ADMIN, f.draw.id)).rejects.toThrow(
      /ปิดบัญชีแล้ว/,
    );
  });
});

describe("Audit trail", () => {
  test("ทุกขั้นของเส้นทางเงินถูกบันทึกพร้อม requestId", async () => {
    const { threeTop } = f.prizeTypes;
    await confirmedBill(f.actors.AGENT1, [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([{ prizeTypeId: threeTop.id, value: "123" }]);
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    const events = await prisma.auditEvent.findMany({
      where: { organizationId: f.org.id },
      orderBy: { createdAt: "asc" },
    });

    const kinds = events.map((e) => `${e.entityType}:${e.action}`);
    expect(kinds).toContain("Bill:CREATE");
    expect(kinds).toContain("Bill:CONFIRM");
    expect(kinds).toContain("Draw:LOCK");
    expect(kinds).toContain("Result:CREATE");
    expect(kinds).toContain("Result:APPROVE");

    // ไม่มีเหตุการณ์ไหนขาด requestId — ถ้าขาดแปลว่าตามรอยข้ามชั้นไม่ได้
    expect(events.every((e) => e.requestId === "integration-test")).toBe(true);
  });
});

/**
 * แก้ผลหลังคำนวณเงินไปแล้ว
 *
 * จุดอันตรายที่สุดของทางแก้ผล: ถ้าปล่อยให้ยอดที่คำนวณแล้วค้างอยู่บนผลเก่า
 * ผู้อนุมัติคนถัดไปจะเซ็นปิดบัญชีบนตัวเลขที่ไม่ตรงกับผลที่ประกาศจริง
 */
describe("แก้ผลหลังคำนวณแล้ว", () => {
  async function settledDraw() {
    const { threeTop } = f.prizeTypes;
    await confirmedBill(f.actors.AGENT1, [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
    ]);
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([{ prizeTypeId: threeTop.id, value: "123" }]);
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    const settlement = await prisma.settlement.findFirstOrThrow({
      where: { drawId: f.draw.id },
    });
    return settlement.id;
  }

  test("อนุมัติการแก้ผลแล้วยอดเดิมถูกล้าง และรอบกลับไปรอคำนวณใหม่", async () => {
    const settlementId = await settledDraw();

    expect(
      (await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } })).status,
    ).toBe("DRAFT");
    expect((await prisma.draw.findUniqueOrThrow({ where: { id: f.draw.id } })).status).toBe(
      "SETTLED",
    );

    await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "999",
      reason: "ประกาศเลขผิด",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });
    await approveResult(f.actors.OWNER, draft.id);

    const settlement = await prisma.settlement.findUniqueOrThrow({ where: { id: settlementId } });
    expect(settlement.status).toBe("DRAFT");
    expect(settlement.reconciledById).toBeNull();
    expect(settlement.reconciledAt).toBeNull();

    const draw = await prisma.draw.findUniqueOrThrow({ where: { id: f.draw.id } });
    expect(draw.status).toBe("RESULT_PENDING");
  });

  test("ปิดบัญชีทันทีหลังแก้ผลไม่ได้ ต้องคำนวณใหม่ก่อน", async () => {
    await settledDraw();
    await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "999",
      reason: "ประกาศเลขผิด",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });
    await approveResult(f.actors.OWNER, draft.id);

    await expect(approveSettlement(f.actors.OWNER, f.draw.id)).rejects.toThrow(/คำนวณ/);
  });

  test("คำนวณใหม่แล้วได้ตัวเลขตามผลใหม่ ไม่ใช่ผลเดิม", async () => {
    await settledDraw();
    await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "999",
      reason: "ประกาศเลขผิด",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });
    await approveResult(f.actors.OWNER, draft.id);

    const previews = await calculateSettlement(f.actors.ADMIN, f.draw.id);
    const a1 = previews[0]!;
    // เลขที่แทงคือ 123 ผลใหม่คือ 999 จึงไม่ถูกรางวัลแล้ว
    expect(a1.payout.toFixed(2)).toBe("0.00");
    expect(a1.winningItems).toBe(0);
    expect(a1.gross.toFixed(2)).toBe("100.00");

    const item = await prisma.billItem.findFirstOrThrow({
      where: { prizeTypeId: f.prizeTypes.threeTop.id },
      select: { isWinner: true, payout: true },
    });
    expect(item.isWinner).toBe(false);
    expect(item.payout.toFixed(2)).toBe("0.00");
  });

  test("รอบที่ปิดบัญชีแล้วเสนอแก้ผลไม่ได้", async () => {
    const settlementId = await settledDraw();
    void settlementId;
    await approveSettlement(f.actors.OWNER, f.draw.id);

    await expect(
      proposeResultCorrection(f.actors.ADMIN, {
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "999",
        reason: "ขอแก้หลังปิดบัญชี",
      }),
    ).rejects.toThrow(/ปิดบัญชีแล้ว/);
  });
});

import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { approveResult, enterResult } from "@/lib/results/service";
import {
  approveSettlement,
  calculateSettlement,
  reconcileSettlement,
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
    await approveResult(f.actors.CHECKER, d.id);
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
    ]);

    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await approveResults([
      { prizeTypeId: threeTop.id, value: "123" },
      { prizeTypeId: threeTod.id, value: "123" },
      { prizeTypeId: runTop.id, value: "123" },
    ]);

    const previews = await calculateSettlement(f.actors.ADMIN, f.draw.id);

    expect(previews).toHaveLength(1);
    const a1 = previews[0]!;
    expect(a1.gross.toFixed(2)).toBe("180.00");
    expect(a1.payout.toFixed(2)).toBe("93032.00");
    expect(a1.commission.toFixed(2)).toBe("45.00"); // 180 × 25%
    expect(a1.net.toFixed(2)).toBe("-92897.00");
    expect(a1.winningItems).toBe(3);
    expect(a1.totalItems).toBe(4);
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

    // กรอกผลแต่ยังไม่ให้ Checker อนุมัติ
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: threeTop.id,
      value: "123",
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

  test("ปิดบัญชีไม่ได้ถ้ายังไม่กระทบยอดครบ", async () => {
    await readyToClose();
    await expect(approveSettlement(f.actors.OWNER, f.draw.id)).rejects.toThrow(
      /ยังไม่ได้กระทบยอด/,
    );
  });

  test("ปิดบัญชีแล้วรอบและบิลเปลี่ยนสถานะ และคำนวณซ้ำไม่ได้อีก", async () => {
    await readyToClose();

    for (const s of await prisma.settlement.findMany({ where: { drawId: f.draw.id } })) {
      await reconcileSettlement(f.actors.ADMIN, s.id);
    }
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

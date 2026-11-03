import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, getBill, replaceDraftItems } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { approveResult, enterResult, rejectResult } from "@/lib/results/service";
import {
  approveSettlement,
  calculateSettlement,
  reconcileSettlement,
} from "@/lib/settlement/service";
import { searchBills } from "@/lib/reports/service";

/**
 * ด่านกำกับที่ต้องไม่พังโดยไม่มีใครรู้
 *
 * สองเรื่อง: Maker-Checker และการแยกข้อมูลระหว่าง Agent
 *
 * สำคัญ: ทดสอบด้วย OWNER ที่มีสิทธิ์ทั้งสองบทบาท เพราะถ้าใช้ ADMIN
 * จะติดด่านสิทธิ์ตามบทบาทก่อน แล้ว test จะผ่านทั้งที่ด่าน Maker-Checker
 * ไม่เคยถูกเรียกเลย
 */

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function lockedDrawWithBill() {
  const { billId } = await createDraftBill(f.actors.AGENT1, {
    drawId: f.draw.id,
    title: "บิลสำหรับทดสอบด่าน",
  });
  await replaceDraftItems(f.actors.AGENT1, billId, [
    { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
  ]);
  await confirmBill(f.actors.AGENT1, billId);
  await lockDrawManually(f.actors.ADMIN, f.draw.id);
  return billId;
}

describe("Maker-Checker ของผลรางวัล", () => {
  test("ผู้กรอกผลอนุมัติผลของตัวเองไม่ได้ แม้มีสิทธิ์ทั้งสองอย่าง", async () => {
    await lockedDrawWithBill();

    await enterResult(f.actors.OWNER, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });

    await expect(approveResult(f.actors.OWNER, draft.id)).rejects.toThrow(
      /ผู้กรอกผลกับผู้อนุมัติผลต้องไม่ใช่คนเดียวกัน/,
    );

    // คนอื่นอนุมัติได้ปกติ
    await approveResult(f.actors.CHECKER, draft.id);
    const after = await prisma.result.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.checkerId).toBe(f.users.checker.id);
  });

  test("ผู้กรอกผลตีกลับผลของตัวเองไม่ได้", async () => {
    await lockedDrawWithBill();
    await enterResult(f.actors.OWNER, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });

    await expect(rejectResult(f.actors.OWNER, draft.id, "ลองตีกลับเอง")).rejects.toThrow(
      /ต้องไม่ใช่คนเดียวกัน/,
    );
  });

  test("ผลที่อนุมัติแล้วแก้ทับไม่ได้", async () => {
    await lockedDrawWithBill();
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });
    await approveResult(f.actors.CHECKER, draft.id);

    await expect(
      enterResult(f.actors.ADMIN, {
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "456",
      }),
    ).rejects.toThrow(/ได้รับการอนุมัติแล้ว/);
  });

  test("ตีกลับแล้วกรอกใหม่ได้ และเก็บเป็น version ใหม่", async () => {
    await lockedDrawWithBill();
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "111",
    });
    const first = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });
    await rejectResult(f.actors.CHECKER, first.id, "เลขผิด");

    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });

    const all = await prisma.result.findMany({
      where: { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTop.id },
      orderBy: { version: "asc" },
    });

    expect(all).toHaveLength(2);
    expect(all[0]!.version).toBe(1);
    expect(all[0]!.status).toBe("REJECTED");
    expect(all[0]!.rejectReason).toBe("เลขผิด");
    expect(all[1]!.version).toBe(2);
    expect(all[1]!.value).toBe("123");
  });
});

describe("Maker-Checker ของการปิดบัญชี", () => {
  test("ผู้กระทบยอดอนุมัติปิดบัญชีเองไม่ได้", async () => {
    await lockedDrawWithBill();
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });
    await approveResult(f.actors.CHECKER, draft.id);
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    // OWNER กระทบยอดเอง แล้วลองปิดบัญชีเอง
    for (const s of await prisma.settlement.findMany({ where: { drawId: f.draw.id } })) {
      await reconcileSettlement(f.actors.OWNER, s.id);
    }

    await expect(approveSettlement(f.actors.OWNER, f.draw.id)).rejects.toThrow(
      /ผู้กระทบยอดกับผู้อนุมัติปิดบัญชีต้องไม่ใช่คนเดียวกัน/,
    );

    const draw = await prisma.draw.findUniqueOrThrow({ where: { id: f.draw.id } });
    expect(draw.status).toBe("SETTLED");
  });
});

describe("การแยกข้อมูลระหว่าง Agent", () => {
  async function billOfAgent2() {
    const { billId } = await createDraftBill(f.actors.AGENT2, {
      drawId: f.draw.id,
      title: "บิลของ A002",
    });
    await replaceDraftItems(f.actors.AGENT2, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "777", stake: "50" },
    ]);
    await confirmBill(f.actors.AGENT2, billId);
    return billId;
  }

  test("Agent เปิดบิลของอีกคนไม่ได้", async () => {
    const otherBill = await billOfAgent2();
    await expect(getBill(f.actors.AGENT1, otherBill)).rejects.toThrow(/ไม่พบบิล/);
  });

  test("Agent ค้นหาบิลของอีกคนไม่เจอ", async () => {
    await billOfAgent2();
    const found = await searchBills(f.actors.AGENT1, { query: "บิลของ A002" });
    expect(found).toHaveLength(0);

    // แต่ Admin เห็น
    const adminFound = await searchBills(f.actors.ADMIN, { query: "บิลของ A002" });
    expect(adminFound).toHaveLength(1);
  });

  test("Agent แก้บิลของอีกคนไม่ได้", async () => {
    const otherBill = await billOfAgent2();
    await expect(
      replaceDraftItems(f.actors.AGENT1, otherBill, [
        { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "1" },
      ]),
    ).rejects.toThrow(/ไม่พบบิล/);
  });

  test("Agent ยืนยันบิลของอีกคนไม่ได้", async () => {
    const { billId } = await createDraftBill(f.actors.AGENT2, {
      drawId: f.draw.id,
      title: "ร่างของ A002",
    });
    await replaceDraftItems(f.actors.AGENT2, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "777", stake: "50" },
    ]);

    await expect(confirmBill(f.actors.AGENT1, billId)).rejects.toThrow(/ไม่พบบิล/);
  });

  test("Agent สร้างบิลแทนคนอื่นไม่ได้", async () => {
    await expect(
      createDraftBill(f.actors.AGENT1, {
        drawId: f.draw.id,
        title: "แอบสร้างแทน",
        agentId: f.agents.agent2.id,
      }),
    ).rejects.toThrow(/สร้างบิลแทน Agent รายอื่นไม่ได้/);
  });

  test("Agent เห็นเฉพาะยอดของตนเองในรายงาน", async () => {
    await billOfAgent2();
    const { billId } = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "บิลของ A001",
    });
    await replaceDraftItems(f.actors.AGENT1, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    await confirmBill(f.actors.AGENT1, billId);

    const { drawSummary, byAgent } = await import("@/lib/reports/service");

    const mine = await drawSummary(f.actors.AGENT1, f.draw.id);
    expect(mine.gross.toFixed(2)).toBe("100.00");

    const rows = await byAgent(f.actors.AGENT1, f.draw.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.agentCode).toBe("A001");

    // Admin เห็นทั้งสองราย
    const all = await drawSummary(f.actors.ADMIN, f.draw.id);
    expect(all.gross.toFixed(2)).toBe("150.00");
  });
});

describe("เลขบิลไม่ซ้ำ", () => {
  test("ยืนยันหลายบิลพร้อมกันได้เลขบิลคนละเลข", async () => {
    const drafts = await Promise.all(
      [1, 2, 3, 4, 5].map(async (i) => {
        const { billId } = await createDraftBill(f.actors.AGENT1, {
          drawId: f.draw.id,
          title: `บิลที่ ${i}`,
        });
        await replaceDraftItems(f.actors.AGENT1, billId, [
          { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" },
        ]);
        return billId;
      }),
    );

    const confirmed = await Promise.all(drafts.map((id) => confirmBill(f.actors.AGENT1, id)));
    const numbers = confirmed.map((c) => c.billNumber);

    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

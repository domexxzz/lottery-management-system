import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, getBill, replaceDraftItems } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import {
  approveResult,
  enterResult,
  enterResultsBatch,
  proposeResultCorrection,
  rejectResult,
} from "@/lib/results/service";
import {
  approveSettlement,
  calculateSettlement,
} from "@/lib/settlement/service";
import { searchBills } from "@/lib/reports/service";

/**
 * ด่านกำกับที่ต้องไม่พังโดยไม่มีใครรู้
 *
 * สามเรื่อง: One-step result review, การแก้ผลที่ประกาศแล้ว
 * และการแยกข้อมูลระหว่าง Agent
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

describe("ผลรางวัลแบบตรวจรอบเดียว", () => {
  test("บันทึกหลายแถวพร้อมกันและ rollback ทั้งชุดเมื่อมีแถวผิด", async () => {
    await lockedDrawWithBill();
    await expect(enterResultsBatch(f.actors.ADMIN, {
      drawId: f.draw.id,
      results: [
        { prizeTypeId: f.prizeTypes.threeTop.id, value: "123" },
        { prizeTypeId: f.prizeTypes.runTop.id, value: "99" },
      ],
    })).rejects.toThrow(/รางวัล 8/);
    expect(await prisma.result.count({ where: { drawId: f.draw.id } })).toBe(0);

    const outcome = await enterResultsBatch(f.actors.ADMIN, {
      drawId: f.draw.id,
      results: [
        { prizeTypeId: f.prizeTypes.threeTop.id, value: "123" },
        // วิ่งบนประกาศผล 3 หลักตามเลข 3 ตัวบน ไม่ใช่หลักเดียวตามเลขที่แทง
        { prizeTypeId: f.prizeTypes.runTop.id, value: "812" },
      ],
    });
    expect(outcome.count).toBe(2);
    expect(await prisma.result.count({ where: { drawId: f.draw.id, status: "APPROVED" } })).toBe(2);
  });

  test("Admin บันทึกแล้วผลได้รับการยืนยันทันที", async () => {
    await lockedDrawWithBill();
    const outcome = await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
    expect(outcome.autoApproved).toBe(true);
    const result = await prisma.result.findFirstOrThrow({ where: { drawId: f.draw.id } });
    expect(result.status).toBe("APPROVED");
    expect(result.makerId).toBe(f.users.admin.id);
    expect(result.checkerId).toBe(f.users.admin.id);
    expect(result.checkedAt).not.toBeNull();
  });

  test("Owner บันทึกแล้วผลได้รับการยืนยันทันที", async () => {
    await lockedDrawWithBill();
    const outcome = await enterResult(f.actors.OWNER, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
    expect(outcome.autoApproved).toBe(true);
    expect(await prisma.result.count({ where: { drawId: f.draw.id, status: "DRAFT" } })).toBe(0);
  });

  test("ผลที่อนุมัติแล้วแก้ทับไม่ได้", async () => {
    await lockedDrawWithBill();
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
    await expect(
      enterResult(f.actors.ADMIN, {
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "456",
      }),
    ).rejects.toThrow(/ได้รับการอนุมัติแล้ว/);
  });

  test("Admin อนุมัติ DRAFT เก่าที่ตนเป็นผู้กรอกได้", async () => {
    await lockedDrawWithBill();
    const draft = await prisma.result.create({
      data: {
        organizationId: f.org.id,
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "123",
        makerId: f.users.admin.id,
        status: "DRAFT",
      },
    });
    await approveResult(f.actors.ADMIN, draft.id);
    expect((await prisma.result.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("APPROVED");
  });

  test("DRAFT เก่าถูกตีกลับและบันทึกใหม่เป็น version ที่ยืนยันแล้ว", async () => {
    await lockedDrawWithBill();
    const first = await prisma.result.create({
      data: {
        organizationId: f.org.id,
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "111",
        makerId: f.users.admin.id,
        status: "DRAFT",
      },
    });
    await rejectResult(f.actors.ADMIN, first.id, "เลขผิด");
    const outcome = await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });

    expect(outcome.autoApproved).toBe(true);
    const corrected = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTop.id, version: 2 },
    });
    expect(corrected.status).toBe("APPROVED");
    expect(corrected.makerId).toBe(f.users.admin.id);
    expect(corrected.checkerId).toBe(f.users.admin.id);
    expect(corrected.checkedAt).not.toBeNull();

    const approvalAudit = await prisma.auditEvent.findFirst({
      where: { entityType: "Result", entityId: corrected.id, action: "APPROVE" },
    });
    expect(approvalAudit?.reason).toBe("บันทึกและยืนยันผลในขั้นตอนเดียว");
  });
});

describe("Owner ปิดบัญชีรอบ", () => {
  test("Owner ปิดบัญชีได้ทันทีหลังคำนวณ Settlement", async () => {
    await lockedDrawWithBill();
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    await approveSettlement(f.actors.OWNER, f.draw.id);

    const draw = await prisma.draw.findUniqueOrThrow({ where: { id: f.draw.id } });
    expect(draw.status).toBe("CLOSED");
    expect(await prisma.settlement.count({ where: { drawId: f.draw.id, status: "APPROVED", approvedById: f.users.owner.id } })).toBe(1);
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

describe("Owner และ Admin สร้างบิลในนามผู้ใช้งาน", () => {
  test("Owner สร้างบิลในนามตัวเองและระบบสร้าง Agent ชื่อ Owner ให้อัตโนมัติ", async () => {
    const { billId } = await createDraftBill(f.actors.OWNER, {
      drawId: f.draw.id,
      title: "ลูกค้าของ Owner",
      representativeUserId: f.users.owner.id,
    });

    const bill = await prisma.bill.findUniqueOrThrow({
      where: { id: billId },
      select: {
        createdById: true,
        agent: { select: { name: true, commissionRate: true, userId: true } },
      },
    });
    expect(bill.createdById).toBe(f.users.owner.id);
    expect(bill.agent.userId).toBe(f.users.owner.id);
    expect(bill.agent.name).toBe(f.users.owner.displayName);
    expect(bill.agent.commissionRate.toFixed(2)).toBe("0.00");
  });

  test("Admin สร้างบิลในนามตัวเองหรือ Agent ได้ แต่สร้างในนาม Owner ไม่ได้", async () => {
    const self = await createDraftBill(f.actors.ADMIN, {
      drawId: f.draw.id,
      title: "ลูกค้าของ Admin",
      representativeUserId: f.users.admin.id,
    });
    const ownBill = await prisma.bill.findUniqueOrThrow({
      where: { id: self.billId },
      select: { agent: { select: { name: true, userId: true } } },
    });
    expect(ownBill.agent).toMatchObject({ name: f.users.admin.displayName, userId: f.users.admin.id });

    await expect(createDraftBill(f.actors.ADMIN, {
      drawId: f.draw.id,
      title: "สร้างให้ Owner ไม่ได้",
      representativeUserId: f.users.owner.id,
    })).rejects.toThrow(/ไม่สามารถสร้างบิลในนาม Owner/);

    await expect(createDraftBill(f.actors.ADMIN, {
      drawId: f.draw.id,
      title: "สร้างให้ Agent ได้",
      representativeUserId: f.users.agentUser1.id,
    })).resolves.toBeDefined();
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

/**
 * การแก้ผลที่ประกาศไปแล้ว
 *
 * ก่อนหน้านี้ไม่มีทางแก้เลย ผลที่อนุมัติแล้วถูกล็อกถาวร พิมพ์ผิดหลักเดียว
 * ก็ต้องไปแก้ที่ฐานข้อมูลโดยตรงซึ่งไม่มี Audit
 * ชุดนี้ล็อกด่านของทางแก้ใหม่ไว้ ไม่ให้กลายเป็นประตูหลัง
 */
describe("แก้ผลรางวัลที่ประกาศแล้ว", () => {
  async function approvedResult() {
    await lockedDrawWithBill();
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "123",
    });
  }

  test("กรอกผลทับผลที่อนุมัติแล้วไม่ได้ ต้องใช้ทางแก้ผล", async () => {
    await approvedResult();
    await expect(
      enterResult(f.actors.ADMIN, {
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "456",
      }),
    ).rejects.toThrow(/เสนอแก้ผล/);
  });

  test("Admin เสนอแก้ได้ แต่ผลเดิมยังมีผลบังคับจนกว่าจะอนุมัติ", async () => {
    await approvedResult();
    const { version } = await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "456",
      reason: "เลขที่ประกาศคลาดเคลื่อนจากต้นทาง",
    });

    expect(version).toBe(2);
    // ผลเดิมยังเป็นตัวที่อนุมัติอยู่ตัวเดียว
    const approved = await prisma.result.findMany({
      where: { drawId: f.draw.id, status: "APPROVED" },
      select: { value: true },
    });
    expect(approved).toEqual([{ value: "123" }]);
  });

  test("Admin อนุมัติการแก้ผลไม่ได้ แม้จะอนุมัติผลครั้งแรกได้", async () => {
    await approvedResult();
    await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "456",
      reason: "แก้เลข",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });

    // Admin มี result.approve แต่ไม่มี result.approveCorrection
    await expect(approveResult(f.actors.ADMIN, draft.id)).rejects.toThrow(/สิทธิ์/);
    expect(
      await prisma.result.count({ where: { drawId: f.draw.id, status: "APPROVED" } }),
    ).toBe(1);
  });

  test("Owner อนุมัติคำขอที่ตัวเองเสนอไม่ได้ ต้องเป็นคนละคน", async () => {
    await approvedResult();
    await proposeResultCorrection(f.actors.OWNER, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "456",
      reason: "แก้เลข",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });

    // ด่านเดียวกับการยกเลิกบิลหลัง Cutoff: ผู้เสนอกับผู้อนุมัติต้องคนละคน
    await expect(approveResult(f.actors.OWNER, draft.id)).rejects.toThrow(/คนเดียวกัน/);
    expect(
      await prisma.result.count({ where: { drawId: f.draw.id, status: "APPROVED" } }),
    ).toBe(1);
  });

  test("Owner เสนอแก้ก็ยังต้องรออนุมัติ ไม่อนุมัติทันทีเหมือนการลงผลครั้งแรก", async () => {
    await approvedResult();
    const { resultId } = await proposeResultCorrection(f.actors.OWNER, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "456",
      reason: "แก้เลข",
    });
    const created = await prisma.result.findUniqueOrThrow({ where: { id: resultId } });
    expect(created.status).toBe("DRAFT");
    expect(created.checkerId).toBeNull();
  });

  test("Owner อนุมัติแล้วผลใหม่มีผลบังคับแทนผลเดิม และเก็บผลเดิมไว้ดูย้อนหลัง", async () => {
    await approvedResult();
    await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "456",
      reason: "แก้เลข",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });

    await approveResult(f.actors.OWNER, draft.id);

    const versions = await prisma.result.findMany({
      where: { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTop.id },
      orderBy: { version: "asc" },
      select: { version: true, value: true, status: true },
    });
    // ผลเดิมไม่ถูกลบหรือเขียนทับ ยังอ่านย้อนหลังได้ว่าเคยประกาศ 123
    expect(versions).toEqual([
      { version: 1, value: "123", status: "APPROVED" },
      { version: 2, value: "456", status: "APPROVED" },
    ]);

    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: "Result", action: "APPROVE" },
      orderBy: { createdAt: "desc" },
      select: { reason: true },
    });
    expect(audit?.reason).toContain("แก้ผล");
  });

  test("คำขอที่ถูกตีกลับแล้วเสนอใหม่ได้", async () => {
    await approvedResult();
    await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "456",
      reason: "แก้เลข",
    });
    const draft = await prisma.result.findFirstOrThrow({
      where: { drawId: f.draw.id, status: "DRAFT" },
    });
    await rejectResult(f.actors.OWNER, draft.id, "เลขที่เสนอก็ยังไม่ตรง");

    // version ล่าสุดเป็น REJECTED แต่ยังเสนอใหม่ได้เพราะผลที่บังคับอยู่คือ version 1
    const second = await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "789",
      reason: "เลขที่ถูกต้องจากต้นทาง",
    });
    expect(second.version).toBe(3);
  });

  test("เสนอซ้อนขณะมีคำขอค้างไม่ได้ และเสนอค่าเดิมไม่ได้", async () => {
    await approvedResult();
    await expect(
      proposeResultCorrection(f.actors.ADMIN, {
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "123",
        reason: "ค่าเดิม",
      }),
    ).rejects.toThrow(/ตรงกับผลเดิม/);

    await proposeResultCorrection(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "456",
      reason: "แก้เลข",
    });
    await expect(
      proposeResultCorrection(f.actors.ADMIN, {
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "789",
        reason: "แก้ซ้อน",
      }),
    ).rejects.toThrow(/ค้างอยู่แล้ว/);
  });

  test("ต้องระบุเหตุผล และ Agent เสนอแก้ไม่ได้", async () => {
    await approvedResult();
    await expect(
      proposeResultCorrection(f.actors.ADMIN, {
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "456",
        reason: "   ",
      }),
    ).rejects.toThrow(/เหตุผล/);

    await expect(
      proposeResultCorrection(f.actors.AGENT1, {
        drawId: f.draw.id,
        prizeTypeId: f.prizeTypes.threeTop.id,
        value: "456",
        reason: "ขอแก้",
      }),
    ).rejects.toThrow();
  });
});

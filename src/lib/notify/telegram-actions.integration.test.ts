import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import {
  buildBillCallbackData,
  buildCallbackData,
  handleEvidenceAction,
  parseCallbackData,
} from "./telegram-actions";

/**
 * การกดปุ่มในแชทเปลี่ยนสถานะหลักฐานจริง
 *
 * สิ่งที่ชุดนี้ต้องพิสูจน์ เรียงตามความสำคัญ
 *   1. บัญชี Telegram ที่ไม่ได้ผูก กดไม่ได้ — ไม่มีทางลัดให้คนนอก
 *   2. ด่านสิทธิ์เดิมยังบังคับอยู่ — Agent กดไม่ได้แม้จะผูกบัญชีแล้ว
 *   3. Audit บันทึกชื่อคนจริง ไม่ใช่ "บอท"
 */

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

let seed = 0;

async function pendingAttachment() {
  const { billId } = await createDraftBill(f.actors.AGENT1, {
    drawId: f.draw.id,
    title: "ลูกค้าหลักฐาน",
  });
  await replaceDraftItems(f.actors.AGENT1, billId, [
    { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
  ]);
  await confirmBill(f.actors.AGENT1, billId);

  seed += 1;
  const attachment = await prisma.billAttachment.create({
    data: {
      organizationId: f.org.id,
      billId,
      type: "PAYMENT_EVIDENCE",
      storageKey: `evidence/action-${seed}.webp`,
      originalName: "slip.jpg",
      mimeType: "image/webp",
      fileSize: 10,
      checksum: `sum-${seed}`,
      uploadedById: f.users.agentUser1.id,
      status: "PENDING",
    },
  });
  return attachment.id;
}

async function link(userId: string, telegramUserId: string) {
  await prisma.user.update({ where: { id: userId }, data: { telegramUserId } });
}

describe("รหัสของปุ่ม", () => {
  test("ระดับไฟล์ สร้างแล้วอ่านกลับได้ตรงกัน", () => {
    expect(parseCallbackData(buildCallbackData("verify", "abc123"))).toEqual({
      scope: "attachment",
      kind: "verify",
      attachmentId: "abc123",
    });
    expect(parseCallbackData(buildCallbackData("reject", "abc123"))).toEqual({
      scope: "attachment",
      kind: "reject",
      attachmentId: "abc123",
    });
  });

  test("ระดับบิล สร้างแล้วอ่านกลับได้ตรงกัน", () => {
    expect(parseCallbackData(buildBillCallbackData("verify", "bill1"))).toEqual({
      scope: "bill",
      kind: "verify",
      billId: "bill1",
    });
    expect(parseCallbackData(buildBillCallbackData("reject", "bill1"))).toEqual({
      scope: "bill",
      kind: "reject",
      billId: "bill1",
    });
  });

  test("รหัสระดับบิลไม่ถูกอ่านสลับเป็นระดับไฟล์", () => {
    // ev:bv: ขึ้นต้นคล้าย ev:v: ถ้าตรวจผิดลำดับจะกลายเป็นไฟล์ชื่อ "v:bill1"
    const parsed = parseCallbackData("ev:bv:bill1");
    expect(parsed).toMatchObject({ scope: "bill", billId: "bill1" });
  });

  test("รหัสที่ไม่รู้จักถูกปฏิเสธ", () => {
    for (const raw of ["", "ev:", "ev:x:1", "สวัสดี", "ev:v:"]) {
      expect(parseCallbackData(raw), raw).toBeNull();
    }
  });

  test("อยู่ในขีดจำกัด 64 ไบต์ของ Telegram", () => {
    for (const data of [
      buildCallbackData("verify", "cmw63c07s003c0ou0gzsief1a"),
      buildBillCallbackData("reject", "cmw51pbnw005d64u04j4jdfcm"),
    ]) {
      expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
    }
  });
});

describe("ตัวตนและสิทธิ์", () => {
  test("บัญชี Telegram ที่ไม่ได้ผูก กดไม่ได้", async () => {
    const attachmentId = await pendingAttachment();

    const outcome = await handleEvidenceAction({
      telegramUserId: "999999",
      action: { scope: "attachment", kind: "verify", attachmentId },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("ยังไม่ได้ผูก");
    const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(after.status).toBe("PENDING");
  });

  test("Agent ที่ผูกบัญชีแล้วก็ยังกดไม่ได้ เพราะไม่มีสิทธิ์ตรวจ", async () => {
    const attachmentId = await pendingAttachment();
    await link(f.users.agentUser1.id, "111111");

    const outcome = await handleEvidenceAction({
      telegramUserId: "111111",
      action: { scope: "attachment", kind: "verify", attachmentId },
    });

    expect(outcome.ok).toBe(false);
    const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(after.status).toBe("PENDING");
  });

  test("ผู้ใช้ที่ถูกระงับกดไม่ได้ แม้เคยผูกไว้", async () => {
    const attachmentId = await pendingAttachment();
    await link(f.users.admin.id, "222222");
    await prisma.user.update({ where: { id: f.users.admin.id }, data: { status: "SUSPENDED" } });

    const outcome = await handleEvidenceAction({
      telegramUserId: "222222",
      action: { scope: "attachment", kind: "verify", attachmentId },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("ยังไม่ได้ผูก");
  });
});

describe("ยืนยันหลักฐาน", () => {
  test("Admin ที่ผูกแล้วกดยืนยันได้ และ Audit บันทึกชื่อคนจริง", async () => {
    const attachmentId = await pendingAttachment();
    await link(f.users.admin.id, "333333");

    const outcome = await handleEvidenceAction({
      telegramUserId: "333333",
      action: { scope: "attachment", kind: "verify", attachmentId },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain(f.users.admin.displayName);

    const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(after.status).toBe("VERIFIED");
    expect(after.verifiedById).toBe(f.users.admin.id);

    // Audit ต้องชี้ไปที่คนจริง ไม่ใช่บัญชีระบบ
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "BillAttachment", entityId: attachmentId, action: "FILE_VERIFIED" },
      select: { actorId: true },
    });
    expect(audit.actorId).toBe(f.users.admin.id);
  });

  test("กดซ้ำไม่พัง และไม่เปลี่ยนอะไรเพิ่ม", async () => {
    const attachmentId = await pendingAttachment();
    await link(f.users.admin.id, "444444");

    const first = await handleEvidenceAction({
      telegramUserId: "444444",
      action: { scope: "attachment", kind: "verify", attachmentId },
    });
    expect(first.ok).toBe(true);

    const second = await handleEvidenceAction({
      telegramUserId: "444444",
      action: { scope: "attachment", kind: "verify", attachmentId },
    });
    expect(second.ok).toBe(false);

    const audits = await prisma.auditEvent.count({
      where: { entityType: "BillAttachment", entityId: attachmentId, action: "FILE_VERIFIED" },
    });
    expect(audits).toBe(1);
  });
});

describe("ตีกลับหลักฐาน", () => {
  test("ตีกลับโดยไม่มีเหตุผลไม่ผ่าน", async () => {
    const attachmentId = await pendingAttachment();
    await link(f.users.admin.id, "555555");

    for (const reason of [undefined, "", "   "]) {
      const outcome = await handleEvidenceAction({
        telegramUserId: "555555",
        action: { scope: "attachment", kind: "reject", attachmentId },
        reason,
      });
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain("เหตุผล");
    }

    const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(after.status).toBe("PENDING");
  });

  test("ตีกลับพร้อมเหตุผลสำเร็จ และเหตุผลถูกเก็บไว้", async () => {
    const attachmentId = await pendingAttachment();
    await link(f.users.admin.id, "666666");

    const outcome = await handleEvidenceAction({
      telegramUserId: "666666",
      action: { scope: "attachment", kind: "reject", attachmentId },
      reason: "สลิปเบลอ อ่านยอดไม่ออก",
    });

    expect(outcome.ok).toBe(true);
    const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(after.status).toBe("REJECTED");
    expect(after.rejectionReason).toBe("สลิปเบลอ อ่านยอดไม่ออก");
  });
});

describe("ขอบเขตองค์กร", () => {
  test("กดหลักฐานขององค์กรอื่นไม่ได้", async () => {
    const attachmentId = await pendingAttachment();
    await link(f.users.admin.id, "777777");

    // ย้ายผู้ใช้ที่ผูกไว้ไปอยู่อีกองค์กร
    const otherOrg = await prisma.organization.create({
      data: { name: "องค์กรอื่น", timezone: "Asia/Bangkok" },
    });
    await prisma.user.update({
      where: { id: f.users.admin.id },
      data: { organizationId: otherOrg.id },
    });

    const outcome = await handleEvidenceAction({
      telegramUserId: "777777",
      action: { scope: "attachment", kind: "verify", attachmentId },
    });

    expect(outcome.ok).toBe(false);
    const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(after.status).toBe("PENDING");
  });
});

describe("ปุ่มระดับบิลทำงานกับหลักฐานทุกใบ", () => {
  async function billWithTwoAttachments() {
    const { billId } = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้าสองไฟล์",
    });
    await replaceDraftItems(f.actors.AGENT1, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    await confirmBill(f.actors.AGENT1, billId);

    const ids: string[] = [];
    for (const type of ["ORDER_EVIDENCE", "PAYMENT_EVIDENCE"] as const) {
      seed += 1;
      const created = await prisma.billAttachment.create({
        data: {
          organizationId: f.org.id,
          billId,
          type,
          storageKey: `evidence/bill-${seed}.webp`,
          originalName: "f.jpg",
          mimeType: "image/webp",
          fileSize: 10,
          checksum: `bill-sum-${seed}`,
          uploadedById: f.users.agentUser1.id,
          status: "PENDING",
        },
      });
      ids.push(created.id);
    }
    return { billId, ids };
  }

  test("กดยืนยันครั้งเดียว ตรวจครบทุกใบของบิล", async () => {
    const { billId, ids } = await billWithTwoAttachments();
    await link(f.users.admin.id, "888001");

    const outcome = await handleEvidenceAction({
      telegramUserId: "888001",
      action: { scope: "bill", kind: "verify", billId },
    });

    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("2/2");

    for (const id of ids) {
      const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe("VERIFIED");
      expect(after.verifiedById).toBe(f.users.admin.id);
    }
  });

  test("กดตีกลับครั้งเดียว ตีกลับครบพร้อมเหตุผลเดียวกัน", async () => {
    const { billId, ids } = await billWithTwoAttachments();
    await link(f.users.admin.id, "888002");

    const outcome = await handleEvidenceAction({
      telegramUserId: "888002",
      action: { scope: "bill", kind: "reject", billId },
      reason: "ยอดในสลิปไม่ตรงกับบิล",
    });

    expect(outcome.ok).toBe(true);
    for (const id of ids) {
      const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe("REJECTED");
      expect(after.rejectionReason).toBe("ยอดในสลิปไม่ตรงกับบิล");
    }
  });

  test("กดซ้ำหลังตรวจครบแล้ว บอกว่าไม่มีอะไรรอตรวจ", async () => {
    const { billId } = await billWithTwoAttachments();
    await link(f.users.admin.id, "888003");

    await handleEvidenceAction({
      telegramUserId: "888003",
      action: { scope: "bill", kind: "verify", billId },
    });
    const second = await handleEvidenceAction({
      telegramUserId: "888003",
      action: { scope: "bill", kind: "verify", billId },
    });

    expect(second.ok).toBe(false);
    expect(second.message).toContain("ไม่มีหลักฐานที่รอตรวจ");
  });

  test("บิลขององค์กรอื่นมองไม่เห็นหลักฐานเลย", async () => {
    const { billId, ids } = await billWithTwoAttachments();
    await link(f.users.admin.id, "888004");

    const otherOrg = await prisma.organization.create({
      data: { name: "องค์กรอื่น", timezone: "Asia/Bangkok" },
    });
    await prisma.user.update({
      where: { id: f.users.admin.id },
      data: { organizationId: otherOrg.id },
    });

    const outcome = await handleEvidenceAction({
      telegramUserId: "888004",
      action: { scope: "bill", kind: "verify", billId },
    });

    expect(outcome.ok).toBe(false);
    for (const id of ids) {
      const after = await prisma.billAttachment.findUniqueOrThrow({ where: { id } });
      expect(after.status).toBe("PENDING");
    }
  });
});

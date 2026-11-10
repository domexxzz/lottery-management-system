import { afterEach, beforeEach, describe, expect, test } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { createDraftBill, confirmBill, replaceDraftItems } from "@/lib/bills/service";
import {
  deleteDraftAttachment,
  duplicateEvidenceHistory,
  listBillAttachments,
  reviewAttachment,
  signedAttachmentUrl,
  uploadBillAttachment,
  verifyBillEvidence,
} from "./service";
import { getStorageProvider, resetStorageProviderForTests } from "@/lib/storage/provider";
import { resetStorageConfigForTests } from "@/lib/storage/config";

let f: Fixtures;

async function image(color: string): Promise<Buffer> {
  return sharp({ create: { width: 320, height: 220, channels: 3, background: color } }).png().toBuffer();
}

async function draft() {
  const { billId } = await createDraftBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้าหลักฐาน" });
  await replaceDraftItems(f.actors.AGENT1, billId, [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }]);
  return billId;
}

beforeEach(async () => {
  process.env.BILL_ORDER_EVIDENCE_REQUIRED = "true";
  process.env.BILL_PAYMENT_EVIDENCE_REQUIRED = "false";
  resetStorageConfigForTests();
  resetStorageProviderForTests();
  f = await freshFixtures();
});

afterEach(async () => {
  const objects = await prisma.billAttachment.findMany({ select: { storageKey: true } });
  const storage = getStorageProvider();
  await Promise.all(objects.map((object) => storage.delete(object.storageKey).catch(() => undefined)));
  process.env.BILL_ORDER_EVIDENCE_REQUIRED = "false";
  process.env.BILL_PAYMENT_EVIDENCE_REQUIRED = "false";
  resetStorageConfigForTests();
  resetStorageProviderForTests();
});

describe("private bill evidence with real MinIO", () => {
  test("Upload → metadata → signed URL → confirm → review → audit", async () => {
    const billId = await draft();
    await expect(confirmBill(f.actors.AGENT1, billId)).rejects.toThrow(/ต้องแนบหลักฐาน/);

    const uploaded = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE",
      fileName: "order.png",
      declaredMimeType: "image/png",
      bytes: await image("#168b98"),
      idempotencyKey: crypto.randomUUID(),
    });
    expect(uploaded.status).toBe("PENDING");

    const stored = await prisma.billAttachment.findUniqueOrThrow({ where: { id: uploaded.id } });
    expect(stored.storageKey).toMatch(new RegExp(`^organizations/${f.org.id}/draws/${f.draw.id}/bills/${billId}/[0-9a-f-]+\\.webp$`));
    expect(await getStorageProvider().objectExists(stored.storageKey)).toBe(true);

    const url = await signedAttachmentUrl(f.actors.AGENT1, uploaded.id, "inline");
    const response = await fetch(url);
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toContain("image/webp");
    await expect(signedAttachmentUrl(f.actors.AGENT2, uploaded.id, "inline")).rejects.toThrow(/ไม่พบหลักฐาน/);

    await confirmBill(f.actors.AGENT1, billId);
    await reviewAttachment(f.actors.ADMIN, uploaded.id, "VERIFIED");
    expect((await prisma.billAttachment.findUniqueOrThrow({ where: { id: uploaded.id } })).status).toBe("VERIFIED");
    expect(await prisma.auditEvent.count({ where: { entityType: "BillAttachment", entityId: uploaded.id } })).toBe(2);
  });

  test("อนุญาตให้แนบรูปเดิมซ้ำและลบเฉพาะ Object ของรายการที่เลือก", async () => {
    const billId = await draft();
    const bytes = await image("#ddaa22");
    const first = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "first.png", declaredMimeType: "image/png", bytes, idempotencyKey: crypto.randomUUID(),
    });
    const second = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "renamed.png", declaredMimeType: "image/png", bytes, idempotencyKey: crypto.randomUUID(),
    });
    expect(second.id).not.toBe(first.id);
    const key = (await prisma.billAttachment.findUniqueOrThrow({ where: { id: first.id } })).storageKey;
    const secondKey = (await prisma.billAttachment.findUniqueOrThrow({ where: { id: second.id } })).storageKey;
    expect(secondKey).not.toBe(key);
    await deleteDraftAttachment(f.actors.AGENT1, first.id);
    expect(await getStorageProvider().objectExists(key)).toBe(false);
    expect(await getStorageProvider().objectExists(secondKey)).toBe(true);
  });

  test("ยืนยันหลักฐานทั้งบิลด้วยปุ่มเดียวและบันทึก Audit ทุกรายการ", async () => {
    const billId = await draft();
    const first = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "one.png", declaredMimeType: "image/png", bytes: await image("#225588"), idempotencyKey: crypto.randomUUID(),
    });
    const second = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "two.png", declaredMimeType: "image/png", bytes: await image("#447799"), idempotencyKey: crypto.randomUUID(),
    });
    await confirmBill(f.actors.AGENT1, billId);

    await expect(verifyBillEvidence(f.actors.ADMIN, billId)).resolves.toBe(2);
    const verified = await prisma.billAttachment.findMany({ where: { id: { in: [first.id, second.id] } } });
    expect(verified.every((item) => item.status === "VERIFIED")).toBe(true);
    expect(await prisma.auditEvent.count({
      where: { entityType: "BillAttachment", entityId: { in: [first.id, second.id] }, action: "FILE_VERIFIED" },
    })).toBe(2);
  });

  test("ตีกลับแล้ว Agent แทนที่ได้โดยเก็บเวอร์ชันเดิม", async () => {
    const billId = await draft();
    const first = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "first.png", declaredMimeType: "image/png", bytes: await image("#cc3344"), idempotencyKey: crypto.randomUUID(),
    });
    await confirmBill(f.actors.AGENT1, billId);
    await reviewAttachment(f.actors.ADMIN, first.id, "REJECTED", "ภาพไม่ชัด กรุณาถ่ายใหม่");
    const replacement = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "clear.png", declaredMimeType: "image/png", bytes: await image("#33aa66"), idempotencyKey: crypto.randomUUID(), replacesId: first.id,
    });
    expect(replacement.replacesId).toBe(first.id);
    const old = await prisma.billAttachment.findUniqueOrThrow({ where: { id: first.id }, include: { replacedBy: true } });
    expect(old.status).toBe("REJECTED");
    expect(old.replacedBy?.id).toBe(replacement.id);
  });

  /*
   * เลิกรับสลิปการชำระเงินแล้ว รับเฉพาะหลักฐานการสั่งซื้อ
   *
   * ด่านอยู่ฝั่งเซิร์ฟเวอร์ ไม่ใช่แค่เอาปุ่มออกจากหน้าจอ
   * เพราะหน้าจอไม่ได้เป็นทางเข้าเดียวของ API
   */
  test("ไม่รับสลิปการชำระเงินอีกต่อไป แม้ยิงเข้ามาตรง ๆ", async () => {
    const billId = await draft();

    await expect(
      uploadBillAttachment(f.actors.AGENT1, billId, {
        type: "PAYMENT_EVIDENCE",
        fileName: "payment.png",
        declaredMimeType: "image/png",
        bytes: await image("#8844aa"),
        idempotencyKey: crypto.randomUUID(),
        payment: {
          amount: "100.50",
          paidAt: new Date(Date.now() - 60_000).toISOString(),
          paymentMethod: "โอนเงิน",
        },
      }),
    ).rejects.toThrow(/รับเฉพาะหลักฐานการสั่งซื้อ/);

    // ปฏิเสธตั้งแต่ต้น ต้องไม่มีทั้งไฟล์และ metadata การชำระเงินตกค้าง
    expect(await prisma.billAttachment.count({ where: { billId } })).toBe(0);
    expect(await prisma.billPayment.count({ where: { billId } })).toBe(0);
  });

  test("แนบหลักฐานการสั่งซื้ออย่างเดียวก็ยืนยันบิลได้", async () => {
    const billId = await draft();
    await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "order.png", declaredMimeType: "image/png", bytes: await image("#3366aa"), idempotencyKey: crypto.randomUUID(),
    });

    // ไม่มีสลิปแล้วต้องไม่ถูกขวาง ไม่งั้นบิลจะยืนยันไม่ได้เลยทั้งระบบ
    await expect(confirmBill(f.actors.AGENT1, billId)).resolves.toBeDefined();
  });

  test("idempotency ไม่สร้าง metadata ซ้ำ และลบหลังยืนยันไม่ได้", async () => {
    const billId = await draft();
    const token = crypto.randomUUID();
    const input = { type: "ORDER_EVIDENCE" as const, fileName: "retry.png", declaredMimeType: "image/png", bytes: await image("#113355"), idempotencyKey: token };
    const first = await uploadBillAttachment(f.actors.AGENT1, billId, input);
    const retry = await uploadBillAttachment(f.actors.AGENT1, billId, input);
    expect(retry.id).toBe(first.id);
    expect(await prisma.billAttachment.count({ where: { billId } })).toBe(1);
    await confirmBill(f.actors.AGENT1, billId);
    await expect(deleteDraftAttachment(f.actors.AGENT1, first.id)).rejects.toThrow(/บิลยังเป็นร่าง/);
    await expect(reviewAttachment(f.actors.AGENT1, first.id, "VERIFIED")).rejects.toThrow(/ไม่มีสิทธิ์/);
  });

  test("Owner ลบหลักฐานที่ยืนยันแล้วได้ แต่ Admin และ Agent ลบไม่ได้", async () => {
    const billId = await draft();
    const uploaded = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE",
      fileName: "owner-delete.png",
      declaredMimeType: "image/png",
      bytes: await image("#115577"),
      idempotencyKey: crypto.randomUUID(),
    });
    const stored = await prisma.billAttachment.findUniqueOrThrow({ where: { id: uploaded.id } });
    await confirmBill(f.actors.AGENT1, billId);

    await expect(deleteDraftAttachment(f.actors.AGENT1, uploaded.id)).rejects.toThrow(/บิลยังเป็นร่าง/);
    await expect(deleteDraftAttachment(f.actors.ADMIN, uploaded.id)).rejects.toThrow(/บิลยังเป็นร่าง|ไม่มีสิทธิ์/);

    await deleteDraftAttachment(f.actors.OWNER, uploaded.id);
    expect(await prisma.billAttachment.findUnique({ where: { id: uploaded.id } })).toBeNull();
    expect(await getStorageProvider().objectExists(stored.storageKey)).toBe(false);
    expect(await prisma.auditEvent.count({ where: { entityType: "BillAttachment", entityId: uploaded.id, action: "FILE_DELETED" } })).toBe(1);
  });
});

/*
 * การนับรูปซ้ำต้องให้ตัวเลขเดียวกันทุกเส้นทาง
 *
 * เส้นทางตอนอัปโหลดเคยนับข้ามทั้งองค์กรโดยไม่กรอง Agent ต่างจากตอนเปิดหน้าใหม่
 * รูปใบเดียวกันจึงขึ้นเลขต่างกันแล้วแต่ว่าดูตอนไหน และ Agent รู้ว่ามีตัวแทน
 * คนอื่นถือรูปเดียวกันอยู่ ทั้งที่กฎขอบเขตห้ามมองข้ามตัวแทน
 */
describe("นับรูปซ้ำตามขอบเขตที่มองเห็น", () => {
  async function sameImageOnBothAgents() {
    const bytes = await image("#7711aa");

    const mine = await createDraftBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ของฉัน" });
    await replaceDraftItems(f.actors.AGENT1, mine.billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" },
    ]);
    const theirs = await createDraftBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ของคนอื่น" });
    await replaceDraftItems(f.actors.AGENT2, theirs.billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "456", stake: "10" },
    ]);

    await uploadBillAttachment(f.actors.AGENT2, theirs.billId, {
      type: "ORDER_EVIDENCE", fileName: "a.png", declaredMimeType: "image/png",
      bytes, idempotencyKey: crypto.randomUUID(),
    });
    const uploaded = await uploadBillAttachment(f.actors.AGENT1, mine.billId, {
      type: "ORDER_EVIDENCE", fileName: "b.png", declaredMimeType: "image/png",
      bytes, idempotencyKey: crypto.randomUUID(),
    });
    return { billId: mine.billId, uploaded };
  }

  test("Agent ไม่เห็นว่าตัวแทนคนอื่นถือรูปเดียวกัน และตัวเลขไม่เปลี่ยนตอนเปิดหน้าใหม่", async () => {
    const { billId, uploaded } = await sameImageOnBothAgents();

    // ตอนอัปโหลดต้องไม่นับใบของ AGENT2
    expect(uploaded.duplicateCount).toBe(1);

    // เปิดหน้าใหม่ต้องได้เลขเดิม ไม่ใช่เลขที่กระโดดเพราะคนละเส้นทาง
    const listed = await listBillAttachments(f.actors.AGENT1, billId);
    expect(listed[0]!.duplicateCount).toBe(uploaded.duplicateCount);

    // ประวัติก็ต้องไม่โผล่ใบของตัวแทนคนอื่น
    const history = await duplicateEvidenceHistory(f.actors.AGENT1, uploaded.id);
    expect(history).toHaveLength(1);
  });

  test("Owner เห็นครบทั้งองค์กร เพราะเป็นคนตรวจว่ามีการเวียนรูปซ้ำ", async () => {
    const { billId, uploaded } = await sameImageOnBothAgents();

    const listed = await listBillAttachments(f.actors.OWNER, billId);
    expect(listed[0]!.duplicateCount).toBe(2);

    const history = await duplicateEvidenceHistory(f.actors.OWNER, uploaded.id);
    expect(history).toHaveLength(2);
  });

  test("รูปคนละใบไม่ถูกนับรวมกัน", async () => {
    const billId = await draft();
    const uploaded = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "only.png", declaredMimeType: "image/png",
      bytes: await image("#0a7f4f"), idempotencyKey: crypto.randomUUID(),
    });
    expect(uploaded.duplicateCount).toBe(1);
  });
});

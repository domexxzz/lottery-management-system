import { afterEach, beforeEach, describe, expect, test } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { createDraftBill, confirmBill, replaceDraftItems } from "@/lib/bills/service";
import {
  deleteDraftAttachment,
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

  test("Payment metadata แยกจากไฟล์และเปลี่ยนสถานะเมื่อตรวจผ่าน", async () => {
    process.env.BILL_PAYMENT_EVIDENCE_REQUIRED = "true";
    resetStorageConfigForTests();
    const billId = await draft();
    await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "ORDER_EVIDENCE", fileName: "order.png", declaredMimeType: "image/png", bytes: await image("#3366aa"), idempotencyKey: crypto.randomUUID(),
    });
    await expect(confirmBill(f.actors.AGENT1, billId)).rejects.toThrow(/หลักฐานและข้อมูลการชำระเงิน/);
    const paymentEvidence = await uploadBillAttachment(f.actors.AGENT1, billId, {
      type: "PAYMENT_EVIDENCE",
      fileName: "payment.png",
      declaredMimeType: "image/png",
      bytes: await image("#8844aa"),
      idempotencyKey: crypto.randomUUID(),
      payment: {
        amount: "100.50",
        paidAt: new Date(Date.now() - 60_000).toISOString(),
        paymentMethod: "โอนเงิน",
        bankName: "ธนาคารทดสอบ",
        transactionReference: `REF-${crypto.randomUUID()}`,
      },
    });
    const paymentBefore = await prisma.billPayment.findUniqueOrThrow({ where: { billId } });
    expect(paymentBefore.amount.toFixed(2)).toBe("100.50");
    expect(paymentBefore.verificationStatus).toBe("PENDING");
    await confirmBill(f.actors.AGENT1, billId);
    await reviewAttachment(f.actors.ADMIN, paymentEvidence.id, "VERIFIED");
    expect((await prisma.billPayment.findUniqueOrThrow({ where: { billId } })).verificationStatus).toBe("VERIFIED");
    expect(await prisma.auditEvent.count({ where: { entityType: "BillPayment", entityId: paymentBefore.id, action: "PAYMENT_VERIFIED" } })).toBe(1);
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
});

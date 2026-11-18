import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { createDraftBill, replaceDraftItems, softDeleteBillBeforeCutoff } from "@/lib/bills/service";
import { deleteDrawPermanently } from "@/lib/draws/service";
import type { PrivateObjectStorage } from "@/lib/storage/types";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

async function draftBill() {
  const draft = await createDraftBill(f.actors.AGENT1, { drawId: f.draw.id, title: "บิลที่ต้องการลบ" });
  await replaceDraftItems(f.actors.AGENT1, draft.billId, [
    { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" },
  ]);
  return draft.billId;
}

describe("การลบบิลแบบเก็บประวัติ", () => {
  test("ลบบิลแล้วคงบิล รายการเลข ผู้ลบ เวลา และ Audit Log", async () => {
    const billId = await draftBill();
    const attachment = await prisma.billAttachment.create({
      data: {
        organizationId: f.org.id,
        billId,
        type: "ORDER_EVIDENCE",
        storageKey: `tests/${billId}/evidence.jpg`,
        originalName: "evidence.jpg",
        mimeType: "image/jpeg",
        fileSize: 128,
        checksum: `checksum-${billId}`,
        uploadedById: f.users.admin.id,
      },
    });

    await softDeleteBillBeforeCutoff(f.actors.ADMIN, billId);
    const deleted = await prisma.bill.findUniqueOrThrow({ where: { id: billId } });
    expect(deleted.status).toBe("CANCELLED");
    expect(deleted.cancelReason).toBe("ลบบิลก่อนปิดรับ");
    expect(deleted.cancelledById).toBe(f.users.admin.id);
    expect(deleted.cancelledAt).toBeInstanceOf(Date);
    expect(await prisma.billItem.count({ where: { billId } })).toBe(1);
    expect(await prisma.billAttachment.findUnique({ where: { id: attachment.id } })).not.toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityType: "Bill", entityId: billId, action: "DELETE" } })).toBe(1);
  });

  test("Owner ลบงวดที่มีบิลได้พร้อมข้อมูลลูกทั้งหมด แต่ Admin ลบไม่ได้", async () => {
    const billId = await draftBill();
    const deletedStorageKeys: string[] = [];
    const storage: PrivateObjectStorage = {
      upload: async () => undefined,
      delete: async (key) => { deletedStorageKeys.push(key); },
      getObjectMetadata: async () => ({ size: 0, contentType: undefined, metadata: {} }),
      download: async () => Buffer.alloc(0),
      getSignedUrl: async () => "https://example.test/evidence",
      objectExists: async () => false,
    };
    const attachment = await prisma.billAttachment.create({
      data: {
        organizationId: f.org.id,
        billId,
        type: "ORDER_EVIDENCE",
        storageKey: `tests/${billId}/draw-delete.jpg`,
        originalName: "draw-delete.jpg",
        mimeType: "image/jpeg",
        fileSize: 128,
        checksum: `draw-delete-${billId}`,
        uploadedById: f.users.admin.id,
      },
    });

    await expect(deleteDrawPermanently(f.actors.ADMIN, f.draw.id)).rejects.toThrow(/ไม่มีสิทธิ์/);
    const outcome = await deleteDrawPermanently(f.actors.OWNER, f.draw.id, storage);

    expect(outcome.billsDeleted).toBe(1);
    expect(outcome.billItemsDeleted).toBe(1);
    expect(outcome.attachmentsDeleted).toBe(1);
    expect(await prisma.draw.findUnique({ where: { id: f.draw.id } })).toBeNull();
    expect(await prisma.bill.findUnique({ where: { id: billId } })).toBeNull();
    expect(await prisma.billAttachment.findUnique({ where: { id: attachment.id } })).toBeNull();
    expect(deletedStorageKeys).toEqual([attachment.storageKey]);
    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { entityType: "Draw", entityId: f.draw.id, action: "DELETE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.reason).toMatch(/ข้อมูลที่ผูกกับงวดถาวร/);
  });

  test("Owner ลบงวดว่างได้", async () => {

    const emptyDraw = await prisma.draw.create({
      data: {
        organizationId: f.org.id,
        name: "งวดว่าง",
        opensAt: new Date("2027-01-01T00:00:00+07:00"),
        cutoffAt: new Date("2027-01-15T14:00:00+07:00"),
        drawDate: new Date("2027-01-16T00:00:00+07:00"),
      },
    });
    const outcome = await deleteDrawPermanently(f.actors.OWNER, emptyDraw.id);

    expect(outcome.drawId).toBe(emptyDraw.id);
    expect(outcome.billsDeleted).toBe(0);
    expect(await prisma.draw.findUnique({ where: { id: emptyDraw.id } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityType: "Draw", entityId: emptyDraw.id, action: "DELETE" } })).toBe(1);
  });
});

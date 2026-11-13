import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { createDraftBill, replaceDraftItems, softDeleteBillBeforeCutoff } from "@/lib/bills/service";
import { deleteDrawPermanently } from "@/lib/draws/service";

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

  test("ไม่ลบงวดที่มีบิล และ Owner ลบได้เฉพาะงวดว่าง", async () => {
    await draftBill();
    await expect(deleteDrawPermanently(f.actors.ADMIN, f.draw.id)).rejects.toThrow(/ไม่มีสิทธิ์/);
    await expect(deleteDrawPermanently(f.actors.OWNER, f.draw.id)).rejects.toThrow(/ต้องเก็บประวัติบิล/);

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

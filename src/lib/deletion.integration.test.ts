import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { createDraftBill, deleteBillPermanently, replaceDraftItems } from "@/lib/bills/service";
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

describe("Owner ลบข้อมูลธุรกรรมแบบถาวร", () => {
  test("ลบบิลพร้อมรายการเลขและคง Audit Log", async () => {
    const billId = await draftBill();

    await expect(deleteBillPermanently(f.actors.ADMIN, billId)).rejects.toThrow(/ไม่มีสิทธิ์/);
    const outcome = await deleteBillPermanently(f.actors.OWNER, billId);

    expect(outcome.billId).toBe(billId);
    expect(await prisma.bill.findUnique({ where: { id: billId } })).toBeNull();
    expect(await prisma.billItem.count({ where: { billId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { entityType: "Bill", entityId: billId, action: "DELETE" } })).toBe(1);
  });

  test("ลบงวดพร้อมบิลและข้อมูลลูกทั้งหมด โดยไม่ให้ Admin ลบ", async () => {
    const billId = await draftBill();

    await expect(deleteDrawPermanently(f.actors.ADMIN, f.draw.id)).rejects.toThrow(/ไม่มีสิทธิ์/);
    const outcome = await deleteDrawPermanently(f.actors.OWNER, f.draw.id);

    expect(outcome.drawId).toBe(f.draw.id);
    expect(outcome.billsDeleted).toBe(1);
    expect(await prisma.draw.findUnique({ where: { id: f.draw.id } })).toBeNull();
    expect(await prisma.bill.findUnique({ where: { id: billId } })).toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityType: "Draw", entityId: f.draw.id, action: "DELETE" } })).toBe(1);
  });
});

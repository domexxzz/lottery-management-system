import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { placeBill } from "@/lib/bills/service";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import { deleteAllEvidence, evidenceSummaryByDraw, purgeExpiredEvidence } from "./retention";

let f: Fixtures;

/** Storage ปลอม จดว่าถูกสั่งลบไฟล์ไหน ไม่ต้องพึ่ง MinIO */
function fakeStorage() {
  const deleted: string[] = [];
  const storage = { delete: async (key: string) => { deleted.push(key); } } as unknown as PrivateObjectStorage;
  return { storage, deleted };
}

beforeEach(async () => {
  f = await freshFixtures();
});

async function billIn(drawId: string) {
  const { billId } = await placeBill(f.actors.AGENT1, { drawId, title: "ลูกค้า", items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }] });
  return billId;
}

let sequence = 0;
async function attach(billId: string, status: "PENDING" | "VERIFIED" | "REJECTED", createdAt = new Date()) {
  sequence += 1;
  return prisma.billAttachment.create({
    data: {
      organizationId: f.org.id,
      billId,
      type: "ORDER_EVIDENCE",
      storageKey: `test/${f.org.id}/${sequence}-${Math.random()}.webp`,
      originalName: `slip-${sequence}.webp`,
      mimeType: "image/webp",
      fileSize: 100,
      checksum: `sum-${sequence}`,
      uploadedById: f.users.agentUser1.id,
      status,
      createdAt,
    },
  });
}

describe("ลบหลักฐานทั้งหมด", () => {
  test("สรุปตามงวด แล้วลบทุกสถานะ (รอตรวจ ผ่าน ตีกลับ) โดยบิลยังอยู่และไม่เปลี่ยนสถานะ", async () => {
    const otherDraw = await prisma.draw.create({
      data: { organizationId: f.org.id, name: "งวดถัดไป", opensAt: new Date(Date.now() - 60_000), cutoffAt: new Date(Date.now() + 2 * 86_400_000) },
    });
    const billA = await billIn(f.draw.id);
    const billB = await billIn(otherDraw.id);
    await attach(billA, "PENDING");
    await attach(billA, "VERIFIED");
    const old = await attach(billA, "REJECTED");
    await prisma.billAttachment.create({
      data: { organizationId: f.org.id, billId: billA, type: "ORDER_EVIDENCE", storageKey: `test/replacement-${Math.random()}`, originalName: "new.webp", mimeType: "image/webp", fileSize: 1, checksum: "x", uploadedById: f.users.agentUser1.id, replacesId: old.id },
    });
    await attach(billB, "VERIFIED");
    const billStatusBefore = await prisma.bill.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } });

    const summary = await evidenceSummaryByDraw(f.actors.OWNER);
    expect(summary.total).toBe(5);
    expect(summary.draws.map((draw) => [draw.drawName, draw.count]).sort()).toEqual([["งวดถัดไป", 1], [f.draw.name, 4]].sort());

    const { storage, deleted } = fakeStorage();
    const result = await deleteAllEvidence(f.actors.OWNER, 5, storage);
    expect(result.deleted).toBe(5);
    expect(deleted).toHaveLength(5);
    expect(await prisma.billAttachment.count()).toBe(0);
    expect(await prisma.bill.findMany({ select: { id: true, status: true }, orderBy: { id: "asc" } })).toEqual(billStatusBefore);
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: "BillAttachment", entityId: "bulk" } });
    expect(audit?.reason).toBe("Owner ลบหลักฐานทั้งหมด");
  });

  test("จำนวนไม่ตรงกับที่เห็นในหน้าต่างยืนยัน ไม่ลบอะไรเลย", async () => {
    await attach(await billIn(f.draw.id), "PENDING");
    const { storage } = fakeStorage();
    await expect(deleteAllEvidence(f.actors.OWNER, 0, storage)).rejects.toThrow(/เปลี่ยนไปแล้ว/);
    expect(await prisma.billAttachment.count()).toBe(1);
  });

  test("เฉพาะ Owner: Admin และ Agent ลบทั้งหมดไม่ได้", async () => {
    const { storage } = fakeStorage();
    await expect(deleteAllEvidence(f.actors.ADMIN, 0, storage)).rejects.toThrow();
    await expect(deleteAllEvidence(f.actors.AGENT1, 0, storage)).rejects.toThrow();
    await expect(evidenceSummaryByDraw(f.actors.ADMIN)).rejects.toThrow();
  });
});

describe("ลบอัตโนมัติเมื่อครบ 1 ปี", () => {
  test("ลบเฉพาะรูปที่แนบมาครบ 1 ปี ไม่สนสถานะการตรวจ", async () => {
    const bill = await billIn(f.draw.id);
    const now = new Date("2027-11-17T03:00:00Z");
    const expiredVerified = await attach(bill, "VERIFIED", new Date("2026-11-17T02:59:59Z"));
    const expiredPending = await attach(bill, "PENDING", new Date("2026-01-01T00:00:00Z"));
    const keep = await attach(bill, "PENDING", new Date("2026-11-17T03:00:01Z"));

    const { storage, deleted } = fakeStorage();
    const result = await purgeExpiredEvidence(now, { storage });
    expect(result.deleted).toBe(2);
    expect(deleted.sort()).toEqual([expiredVerified.storageKey, expiredPending.storageKey].sort());
    expect((await prisma.billAttachment.findMany({ select: { id: true } })).map((row) => row.id)).toEqual([keep.id]);
    const audit = await prisma.auditEvent.findFirst({ where: { entityType: "BillAttachment", entityId: "bulk" } });
    expect(audit).toMatchObject({ actorId: null, reason: "ลบอัตโนมัติ: เก็บครบ 1 ปีแล้ว" });
  });
});

import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { placeBill } from "@/lib/bills/service";
import { lockDrawManually, reopenDrawManually } from "./service";
import { toBangkokDateTimeLocal } from "./schedule";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

describe("เปิดรับงวดอีกครั้ง", () => {
  test("Admin เปิดงวดที่ล็อกแล้วก่อนมีผล และคืนบิลเป็น CONFIRMED", async () => {
    const placed = await placeBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "บิลก่อนปิดรับ",
      items: [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }],
    });
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    const cutoff = new Date(Date.now() + 7_200_000);
    const outcome = await reopenDrawManually(f.actors.ADMIN, f.draw.id, toBangkokDateTimeLocal(cutoff));

    const [draw, bill, audit] = await Promise.all([
      prisma.draw.findUniqueOrThrow({ where: { id: f.draw.id } }),
      prisma.bill.findUniqueOrThrow({ where: { id: placed.billId } }),
      prisma.auditEvent.findFirstOrThrow({ where: { entityType: "Draw", entityId: f.draw.id, action: "UPDATE" }, orderBy: { createdAt: "desc" } }),
    ]);
    expect(outcome.billsUnlocked).toBe(1);
    expect(draw.status).toBe("OPEN");
    expect(draw.lockedAt).toBeNull();
    expect(bill.status).toBe("CONFIRMED");
    expect(audit.reason).toMatch(/เปิดรับงวดอีกครั้ง/);
  });

  test("Agent ไม่มีสิทธิ์เปิดรับงวด และงวดที่เริ่มกรอกผลแล้วเปิดไม่ได้", async () => {
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    const cutoff = toBangkokDateTimeLocal(new Date(Date.now() + 7_200_000));
    await expect(reopenDrawManually(f.actors.AGENT1, f.draw.id, cutoff)).rejects.toThrow(/ไม่มีสิทธิ์/);
    await prisma.draw.update({ where: { id: f.draw.id }, data: { status: "RESULT_PENDING" } });
    await expect(reopenDrawManually(f.actors.OWNER, f.draw.id, cutoff)).rejects.toThrow(/เปิดรับอีกครั้งไม่ได้/);
  });

  test("หวยลาวและหวยลาวชุดที่จับคู่กันเปิดรับพร้อมกัน", async () => {
    const familyId = "family-reopen";
    const common = {
      organizationId: f.org.id,
      laoFamilyId: familyId,
      drawDate: new Date("2026-11-19T00:00:00.000Z"),
      opensAt: new Date(Date.now() - 86_400_000),
      cutoffAt: new Date(Date.now() - 3_600_000),
      status: "LOCKED" as const,
      lockedAt: new Date(),
    };
    const [lao, laoSet] = await Promise.all([
      prisma.draw.create({ data: { ...common, name: "หวยลาวทดสอบ", lotteryType: "LAO" } }),
      prisma.draw.create({ data: { ...common, name: "หวยลาวชุดทดสอบ", lotteryType: "LAO_SET" } }),
    ]);
    const cutoff = toBangkokDateTimeLocal(new Date(Date.now() + 7_200_000));
    const outcome = await reopenDrawManually(f.actors.OWNER, lao.id, cutoff);
    const rows = await prisma.draw.findMany({ where: { id: { in: [lao.id, laoSet.id] } }, orderBy: { lotteryType: "asc" } });

    expect(outcome.drawsReopened).toBe(2);
    expect(rows.map((row) => row.status)).toEqual(["OPEN", "OPEN"]);
    expect(rows[0]?.cutoffAt.toISOString()).toBe(rows[1]?.cutoffAt.toISOString());
  });
});

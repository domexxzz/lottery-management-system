import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { buildReadOnlyBusinessContext } from "./read-only-context";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("Owner AI read-only business context", () => {
  test("คำถามข้อมูลทั้งหมดเปิดโมดูลธุรกิจครบ แต่ไม่มีเครื่องมือแก้ไข", async () => {
    const context = await buildReadOnlyBusinessContext(f.actors.OWNER, "ขอดูข้อมูลทั้งหมดในระบบ");

    expect(context.accessMode).toBe("READ_ONLY");
    expect(context.safety.mutationToolsAvailable).toBe(false);
    expect(context.queryIntent.includedDetailModules).toEqual([
      "users",
      "bills_and_items",
      "results",
      "settlements",
      "evidence_and_payments",
      "audit",
    ]);
    expect(context.rulebook).toHaveLength(3);
    expect(context.directory.agents).toHaveLength(2);
    expect(context.directory.draws).toHaveLength(1);
  });

  test("ไม่ส่ง password hash หรือ session token/hash ให้โมเดล", async () => {
    await prisma.user.update({
      where: { id: f.users.owner.id },
      data: { passwordHash: "SECRET_PASSWORD_HASH_MUST_NOT_LEAK" },
    });
    await prisma.session.create({
      data: {
        userId: f.users.owner.id,
        tokenHash: "SECRET_SESSION_HASH_MUST_NOT_LEAK",
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    const serialized = JSON.stringify(
      await buildReadOnlyBusinessContext(f.actors.OWNER, "ขอดูบัญชีผู้ใช้ทั้งหมด"),
    );
    expect(serialized).not.toContain("SECRET_PASSWORD_HASH_MUST_NOT_LEAK");
    expect(serialized).not.toContain("SECRET_SESSION_HASH_MUST_NOT_LEAK");
  });

  test("การสร้าง context ไม่เปลี่ยนจำนวนข้อมูลในฐานข้อมูล", async () => {
    const before = await Promise.all([
      prisma.user.count(),
      prisma.agent.count(),
      prisma.draw.count(),
      prisma.bill.count(),
      prisma.auditEvent.count(),
    ]);

    await buildReadOnlyBusinessContext(f.actors.OWNER, "ขอดูข้อมูลทั้งหมดในระบบ");

    const after = await Promise.all([
      prisma.user.count(),
      prisma.agent.count(),
      prisma.draw.count(),
      prisma.bill.count(),
      prisma.auditEvent.count(),
    ]);
    expect(after).toEqual(before);
  });
});

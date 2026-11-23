import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { changePassword } from "./login";
import { hashPassword, verifyPassword } from "./password";
import { createSession } from "./session";
import { freshFixtures, type Fixtures } from "@/test/fixtures";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function userFor(role: Role) {
  if (role === "OWNER") return f.users.owner;
  if (role === "ADMIN") return f.users.admin;
  return f.users.agentUser1;
}

describe("ผู้ใช้เปลี่ยนรหัสผ่านของตนเอง", () => {
  test.each(["OWNER", "ADMIN", "AGENT"] satisfies Role[])("%s เปลี่ยนรหัสด้วยรหัสเดิมได้", async (role) => {
    const user = userFor(role);
    const currentPassword = `Current-${role}-123`;
    const newPassword = `Changed-${role}-456`;
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(currentPassword), mustChangePassword: true },
    });
    await Promise.all([
      createSession({ userId: user.id, userAgent: "test-1" }),
      createSession({ userId: user.id, userAgent: "test-2" }),
    ]);

    await changePassword({ userId: user.id, currentPassword, newPassword, requestId: "change-password-test" });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(updated.passwordHash, newPassword)).toBe(true);
    expect(await verifyPassword(updated.passwordHash, currentPassword)).toBe(false);
    expect(updated.mustChangePassword).toBe(false);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(0);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: { not: null } } })).toBe(2);
  });

  test("รหัสเดิมผิดแล้วไม่เปลี่ยนรหัสและไม่ตัด Session", async () => {
    const user = f.users.agentUser1;
    const currentPassword = "Current-Agent-123";
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(currentPassword) } });
    await createSession({ userId: user.id, userAgent: "test-active" });

    await expect(changePassword({
      userId: user.id,
      currentPassword: "Wrong-Agent-123",
      newPassword: "Changed-Agent-456",
    })).rejects.toThrow("รหัสผ่านปัจจุบันไม่ถูกต้อง");

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(unchanged.passwordHash, currentPassword)).toBe(true);
    expect(await prisma.session.count({ where: { userId: user.id, revokedAt: null } })).toBe(1);
  });
});

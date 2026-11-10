import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { verifyPassword } from "@/lib/auth/password";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { createManagedUser, deleteManagedUser, listManagedUsers, setManagedUserPassword } from "./service";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function newAgent(displayName: string, password = "1") {
  return createManagedUser(f.actors.OWNER, { role: "AGENT", displayName, password });
}

describe("Owner จัดการบัญชี", () => {
  test("Agent ได้ชื่อผู้ใช้และรหัส Agent อัตโนมัติเรียงกัน และรหัสผ่านไม่มีข้อกำหนด", async () => {
    const first = await newAgent("ตัวแทน โคราช");
    const second = await newAgent("พี่เบส", "ab");
    const firstNumber = Number(first.login.slice(1));
    expect(first.login).toMatch(/^a\d+$/);
    expect(first.agentCode).toBe(first.login.toUpperCase());
    expect(second.login).toBe(`a${firstNumber + 1}`);

    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: f.org.id, login: second.login } });
    expect(user.mustChangePassword).toBe(false);
    expect(await verifyPassword(user.passwordHash, "ab")).toBe(true);
  });

  test("Owner ตั้งรหัสผ่านใหม่ให้บัญชีอื่นได้ และใช้รหัสใหม่ได้ทันที", async () => {
    const created = await newAgent("ตัวแทน ขอนแก่น", "old");
    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: f.org.id, login: created.login } });
    await setManagedUserPassword(f.actors.OWNER, user.id, "new");
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(updated.passwordHash, "new")).toBe(true);
    expect(await verifyPassword(updated.passwordHash, "old")).toBe(false);
  });

  test("ลบบัญชีที่ยังไม่ใช้งานได้จริง ส่วนบัญชีที่มีบิลถูกซ่อนและเลขไม่ถูกใช้ซ้ำ", async () => {
    const unused = await newAgent("ยังไม่ใช้งาน");
    const unusedUser = await prisma.user.findFirstOrThrow({ where: { organizationId: f.org.id, login: unused.login } });
    expect(await deleteManagedUser(f.actors.OWNER, unusedUser.id)).toEqual({ mode: "erased" });
    expect(await prisma.user.findUnique({ where: { id: unusedUser.id } })).toBeNull();

    // บัญชี Agent ใน fixture มีบิลแล้ว จึงต้องถูกซ่อน ไม่ใช่ลบ
    const { billId } = await createDraftBill(f.actors.AGENT1, { drawId: f.draw.id, title: "บิลก่อนลบ" });
    await replaceDraftItems(f.actors.AGENT1, billId, [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }]);
    await confirmBill(f.actors.AGENT1, billId);
    const agentUserId = f.users.agentUser1.id;
    expect(await deleteManagedUser(f.actors.OWNER, agentUserId)).toEqual({ mode: "hidden" });

    const hidden = await prisma.user.findUniqueOrThrow({ where: { id: agentUserId }, include: { agent: true } });
    expect(hidden.deletedAt).not.toBeNull();
    expect(hidden.status).toBe("SUSPENDED");
    expect(hidden.agent?.status).toBe("CLOSED");
    expect(await prisma.bill.count({ where: { id: billId } })).toBe(1);
    const listed = await listManagedUsers(f.actors.OWNER);
    expect(listed.some((user) => user.id === agentUserId)).toBe(false);

    // เลขของบัญชีที่ถูกซ่อน (มีประวัติ) ไม่ถูกนำกลับมาใช้
    // ส่วนเลขของบัญชีที่ลบจริง (ไม่เคยใช้งาน) นำกลับมาใช้ได้ เพราะไม่มีบิลใดอ้างถึง
    const hiddenNumber = hidden.agent ? Number(/\d+/.exec(hidden.agent.code)?.[0]) : 0;
    const next = await newAgent("บัญชีถัดไป");
    expect(Number(next.login.slice(1))).toBeGreaterThan(hiddenNumber);
    expect(next.login).toBe(unused.login);
  });

  test("Owner ลบหรือตั้งรหัสผ่านบัญชีตัวเองหรือบัญชี Owner ไม่ได้", async () => {
    await expect(deleteManagedUser(f.actors.OWNER, f.users.owner.id)).rejects.toThrow();
    await expect(setManagedUserPassword(f.actors.OWNER, f.users.owner.id, "x")).rejects.toThrow();
  });
});

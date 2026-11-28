import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { verifyPassword } from "@/lib/auth/password";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { getOrganizationMapData } from "@/lib/agents/organization-map";
import {
  applyCommissionPromotion,
  clearCommissionPromotion,
  createManagedUser,
  listAgentPromotions,
  deleteManagedUser,
  listManagedUsers,
  setManagedUserPassword,
  updateManagedUser,
  type UpdateManagedUserInput,
} from "./service";

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
    const agent = await prisma.agent.findUniqueOrThrow({ where: { userId: user.id } });
    expect(agent.commissionRate.toString()).toBe("30");
    expect(agent.laoCommissionRate.toString()).toBe("28");
  });

  test("Owner ตั้งรหัสผ่านใหม่ให้บัญชีอื่นได้ และใช้รหัสใหม่ได้ทันที", async () => {
    const created = await newAgent("ตัวแทน ขอนแก่น", "old");
    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: f.org.id, login: created.login } });
    await setManagedUserPassword(f.actors.OWNER, user.id, "new");
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(updated.passwordHash, "new")).toBe(true);
    expect(await verifyPassword(updated.passwordHash, "old")).toBe(false);
  });

  test("Owner แก้ข้อมูลบัญชีและ Agent ได้ แต่เปลี่ยน username ไม่ได้แม้ client ส่งค่าแฝงมา", async () => {
    const created = await newAgent("ตัวแทนเดิม", "old");
    const user = await prisma.user.findFirstOrThrow({
      where: { organizationId: f.org.id, login: created.login },
      include: { agent: true },
    });

    const input: UpdateManagedUserInput & { login: string } = {
      login: "hacked-username",
      displayName: "ตัวแทนใหม่",
      role: "AGENT",
      status: "SUSPENDED",
      password: "new-password",
      agentCode: "ZX9",
      agentName: "สาขาใหม่",
      commissionRate: "25.5",
      laoCommissionRate: "27.25",
      commissionPromotionStartsOn: "2026-11-01",
      commissionPromotionEndsOn: "2026-12-01",
      commissionPromotionThaiMinGross: "20000",
      commissionPromotionLaoMinGross: "15000",
      commissionPromotionThaiRate: "35",
      commissionPromotionLaoRate: "30",
      creditLimit: "5000",
      perNumberLimit: "250",
    };
    const result = await updateManagedUser(f.actors.OWNER, user.id, input);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { agent: true } });
    expect(result.login).toBe(created.login);
    expect(updated.login).toBe(created.login);
    expect(updated.displayName).toBe("ตัวแทนใหม่");
    expect(updated.status).toBe("SUSPENDED");
    expect(updated.mustChangePassword).toBe(false);
    expect(await verifyPassword(updated.passwordHash, "new-password")).toBe(true);
    expect(updated.agent).toMatchObject({ code: "ZX9", name: "สาขาใหม่", status: "SUSPENDED" });
    expect(updated.agent?.commissionRate.toString()).toBe("25.5");
    expect(updated.agent?.laoCommissionRate.toString()).toBe("27.25");
    expect(updated.agent?.commissionPromotionStartsOn?.toISOString().slice(0, 10)).toBe("2026-11-01");
    expect(updated.agent?.commissionPromotionEndsOn?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(updated.agent?.commissionPromotionThaiMinGross?.toString()).toBe("20000");
    expect(updated.agent?.commissionPromotionLaoMinGross?.toString()).toBe("15000");
    expect(updated.agent?.commissionPromotionThaiRate?.toString()).toBe("35");
    expect(updated.agent?.commissionPromotionLaoRate?.toString()).toBe("30");
    expect(updated.agent?.creditLimit?.toString()).toBe("5000");
    expect(updated.agent?.perNumberLimit?.toString()).toBe("250");

    const audit = await prisma.auditEvent.findFirstOrThrow({
      where: { organizationId: f.org.id, entityType: "User", entityId: user.id, action: "UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit.before).toMatchObject({ login: created.login });
    expect(audit.after).toMatchObject({ login: created.login, displayName: "ตัวแทนใหม่" });
  });

  test("โปรโมชั่นค่าคอมต้องกรอกครบ และล้างทั้งหมดเพื่อกลับไปใช้ค่าปกติได้", async () => {
    const created = await newAgent("ตัวแทนโปรโมชัน");
    const user = await prisma.user.findFirstOrThrow({ where: { organizationId: f.org.id, login: created.login } });
    const base = {
      displayName: "ตัวแทนโปรโมชัน",
      role: "AGENT" as const,
      status: "ACTIVE" as const,
      commissionRate: "30",
      laoCommissionRate: "28",
    };

    await expect(updateManagedUser(f.actors.OWNER, user.id, {
      ...base,
      commissionPromotionStartsOn: "2026-11-01",
    })).rejects.toThrow("กรอกช่วงวันโปรโมชั่นให้ครบ");

    await expect(updateManagedUser(f.actors.OWNER, user.id, {
      ...base,
      commissionPromotionStartsOn: "2026-11-01",
      commissionPromotionEndsOn: "2026-12-01",
      commissionPromotionThaiMinGross: "20000",
    })).rejects.toThrow("หวยรัฐบาลให้ครบทั้งคู่");

    await updateManagedUser(f.actors.OWNER, user.id, {
      ...base,
      commissionPromotionStartsOn: "2026-11-01",
      commissionPromotionEndsOn: "2026-12-01",
      commissionPromotionThaiMinGross: "20000",
      commissionPromotionThaiRate: "35",
    });
    const thaiOnly = await prisma.agent.findUniqueOrThrow({ where: { userId: user.id } });
    expect(thaiOnly.commissionPromotionThaiMinGross?.toString()).toBe("20000");
    expect(thaiOnly.commissionPromotionLaoMinGross).toBeNull();

    await updateManagedUser(f.actors.OWNER, user.id, {
      ...base,
      commissionPromotionStartsOn: "2026-11-01",
      commissionPromotionEndsOn: "2026-12-01",
      commissionPromotionThaiMinGross: "20000",
      commissionPromotionLaoMinGross: "15000",
      commissionPromotionThaiRate: "35",
      commissionPromotionLaoRate: "30",
    });
    await updateManagedUser(f.actors.OWNER, user.id, base);

    const agent = await prisma.agent.findUniqueOrThrow({ where: { userId: user.id } });
    expect(agent.commissionPromotionStartsOn).toBeNull();
    expect(agent.commissionPromotionEndsOn).toBeNull();
    expect(agent.commissionPromotionThaiMinGross).toBeNull();
    expect(agent.commissionPromotionLaoMinGross).toBeNull();
    expect(agent.commissionPromotionThaiRate).toBeNull();
    expect(agent.commissionPromotionLaoRate).toBeNull();
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
    const agentOverview = await getOrganizationMapData(f.actors.OWNER);
    expect(agentOverview.agents.some((agent) => agent.id === hidden.agent?.id)).toBe(false);
    expect(agentOverview.stats.some((row) => row.agentId === hidden.agent?.id)).toBe(false);
    expect(agentOverview.topCustomers.some((row) => row.agentId === hidden.agent?.id)).toBe(false);

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

describe("ตั้งโปรโมชั่นค่าคอมพร้อมกันหลายคน", () => {
  const campaign = {
    commissionPromotionStartsOn: "2026-12-01",
    commissionPromotionEndsOn: "2026-12-31",
    commissionPromotionThaiMinGross: "20000",
    commissionPromotionThaiRate: "32",
  };

  test("เขียนเกณฑ์ชุดเดียวให้ทุกคนที่เลือก และไม่แตะคนที่ไม่ได้เลือก", async () => {
    const count = await applyCommissionPromotion(f.actors.OWNER, [f.agents.agent1.id], campaign);
    expect(count).toBe(1);

    const rows = await listAgentPromotions(f.actors.OWNER, "2026-12-10");
    const first = rows.find((row) => row.agentId === f.agents.agent1.id)!;
    const second = rows.find((row) => row.agentId === f.agents.agent2.id)!;
    expect(first.promotion.state).toBe("ACTIVE");
    expect(first.promotion.thai?.rate.toString()).toBe("32");
    expect(second.promotion.state).toBe("NONE");
  });

  test("ตั้งให้สองคนพร้อมกันได้ด้วยการกรอกครั้งเดียว", async () => {
    const count = await applyCommissionPromotion(f.actors.OWNER, [f.agents.agent1.id, f.agents.agent2.id], campaign);
    expect(count).toBe(2);
    const rows = await listAgentPromotions(f.actors.OWNER, "2026-12-10");
    expect(rows.filter((row) => row.promotion.state === "ACTIVE")).toHaveLength(2);
  });

  test("ล้างโปรโมชั่นแล้วกลับไปใช้อัตราปกติ", async () => {
    await applyCommissionPromotion(f.actors.OWNER, [f.agents.agent1.id], campaign);
    await clearCommissionPromotion(f.actors.OWNER, [f.agents.agent1.id]);
    const rows = await listAgentPromotions(f.actors.OWNER, "2026-12-10");
    expect(rows.find((row) => row.agentId === f.agents.agent1.id)!.promotion.state).toBe("NONE");
  });

  test("ใช้การตรวจค่าชุดเดียวกับการแก้ทีละคน ค่าที่ไม่ครบคู่ถูกปฏิเสธ", async () => {
    await expect(applyCommissionPromotion(f.actors.OWNER, [f.agents.agent1.id], {
      ...campaign,
      commissionPromotionThaiRate: "",
    })).rejects.toThrow(/ยอดขั้นต่ำและค่าคอมหวยรัฐบาล/);

    await expect(applyCommissionPromotion(f.actors.OWNER, [f.agents.agent1.id], {
      ...campaign,
      commissionPromotionEndsOn: "2026-11-01",
    })).rejects.toThrow(/วันสิ้นสุดโปรโมชั่นต้องไม่ก่อนวันเริ่มต้น/);
  });

  test("ไม่เลือกใครเลยถูกปฏิเสธ ไม่ใช่เขียนให้ทุกคนโดยไม่ตั้งใจ", async () => {
    await expect(applyCommissionPromotion(f.actors.OWNER, [], campaign)).rejects.toThrow(/เลือก Agent/);
    await expect(clearCommissionPromotion(f.actors.OWNER, [])).rejects.toThrow(/เลือก Agent/);
  });

  test("Agent เรียกเองไม่ได้ ต้องมีสิทธิ์จัดการผู้ใช้", async () => {
    await expect(applyCommissionPromotion(f.actors.AGENT1, [f.agents.agent1.id], campaign)).rejects.toThrow();
  });

  test("Agent ขององค์กรอื่นไม่ถูกเขียนทับ แม้จะส่ง id มาตรง ๆ", async () => {
    const otherOrg = await prisma.organization.create({ data: { name: "องค์กรอื่น", timezone: "Asia/Bangkok" } });
    const outsider = await prisma.agent.create({
      data: { organizationId: otherOrg.id, code: "Z001", name: "ตัวแทนองค์กรอื่น", commissionRate: "25", laoCommissionRate: "25" },
    });

    await expect(applyCommissionPromotion(f.actors.OWNER, [outsider.id], campaign)).rejects.toThrow(/ไม่พบ Agent/);
    const after = await prisma.agent.findUniqueOrThrow({ where: { id: outsider.id }, select: { commissionPromotionStartsOn: true } });
    expect(after.commissionPromotionStartsOn).toBeNull();
  });
});

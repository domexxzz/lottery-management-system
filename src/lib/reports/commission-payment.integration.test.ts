import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { commissionDrawDateKey } from "./commission-period";
import { markAgentCommissionPaid, unmarkAgentCommissionPaid } from "./commission-payment";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
  await prisma.settlement.create({
    data: {
      organizationId: f.org.id,
      drawId: f.draw.id,
      agentId: f.agents.agent1.id,
      gross: "100.00",
      payout: "0.00",
      commission: "25.00",
      net: "75.00",
      commissionRateSnapshot: "25.0000",
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("เช็กลิสต์จ่ายค่าคอมรายเดือน", () => {
  test("บันทึกยอด snapshot ผู้จ่าย และ Audit ครบ", async () => {
    const month = commissionDrawDateKey(f.draw.drawDate ?? f.draw.cutoffAt).slice(0, 7);
    const payment = await markAgentCommissionPaid(f.actors.ADMIN, { agentId: f.agents.agent1.id, month });

    expect(payment.totalCommissionSnapshot.toFixed(2)).toBe("25.00");
    expect(payment.thaiCommissionSnapshot.toFixed(2)).toBe("25.00");
    expect(payment.laoCommissionSnapshot.toFixed(2)).toBe("0.00");
    expect(payment.paidById).toBe(f.users.admin.id);
    expect(payment.voidedAt).toBeNull();

    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "AgentCommissionPayment", entityId: payment.id } });
    expect(audit.action).toBe("CREATE");
    expect(audit.requestId).toBe("integration-test");
  });

  test("กดจ่ายซ้ำอัปเดต record เดิม ไม่สร้างรายการซ้ำ", async () => {
    const month = commissionDrawDateKey(f.draw.drawDate ?? f.draw.cutoffAt).slice(0, 7);
    const first = await markAgentCommissionPaid(f.actors.OWNER, { agentId: f.agents.agent1.id, month });
    await prisma.settlement.updateMany({ where: { agentId: f.agents.agent1.id }, data: { commission: "30.00" } });
    const second = await markAgentCommissionPaid(f.actors.OWNER, { agentId: f.agents.agent1.id, month });

    expect(second.id).toBe(first.id);
    expect(second.totalCommissionSnapshot.toFixed(2)).toBe("30.00");
    expect(await prisma.agentCommissionPayment.count()).toBe(1);
  });

  test("ยกเลิกเครื่องหมายโดยไม่ลบประวัติ", async () => {
    const month = commissionDrawDateKey(f.draw.drawDate ?? f.draw.cutoffAt).slice(0, 7);
    const first = await markAgentCommissionPaid(f.actors.ADMIN, { agentId: f.agents.agent1.id, month });
    await unmarkAgentCommissionPaid(f.actors.ADMIN, { agentId: f.agents.agent1.id, month });

    const stored = await prisma.agentCommissionPayment.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.voidedAt).not.toBeNull();
    expect(stored.voidedById).toBe(f.users.admin.id);
    expect(await prisma.auditEvent.count({ where: { entityId: first.id } })).toBe(2);
  });

  test("Agent ไม่มีสิทธิ์ทำเครื่องหมายจ่ายค่าคอม", async () => {
    const month = commissionDrawDateKey(f.draw.drawDate ?? f.draw.cutoffAt).slice(0, 7);
    await expect(markAgentCommissionPaid(f.actors.AGENT1, { agentId: f.agents.agent1.id, month })).rejects.toThrow(/ไม่มีสิทธิ์/);
  });
});

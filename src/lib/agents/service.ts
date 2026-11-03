import { Prisma } from "@prisma/client";
import type { AgentStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

export type AgentInput = {
  code: string;
  name: string;
  commissionRate: string;
  creditLimit: string;
  perNumberLimit: string;
};

function parseRate(raw: string): Prisma.Decimal {
  let value: Prisma.Decimal;
  try {
    value = new Prisma.Decimal(raw);
  } catch {
    throw new ValidationError("อัตราคอมมิชชันต้องเป็นตัวเลข");
  }
  if (value.lessThan(0) || value.greaterThan(100)) {
    throw new ValidationError("อัตราคอมมิชชันต้องอยู่ระหว่าง 0 ถึง 100");
  }
  return value;
}

/** ช่องวงเงินที่เว้นว่างหมายถึงไม่จำกัด ไม่ใช่ศูนย์ */
function parseOptionalLimit(raw: string, label: string): Prisma.Decimal | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;

  let value: Prisma.Decimal;
  try {
    value = new Prisma.Decimal(trimmed);
  } catch {
    throw new ValidationError(`${label}ต้องเป็นตัวเลข`);
  }
  if (value.lessThanOrEqualTo(0)) {
    throw new ValidationError(`${label}ต้องมากกว่า 0 หรือเว้นว่างเพื่อไม่จำกัด`);
  }
  return value;
}

export async function listAgents(actor: Actor) {
  requirePermission(actor, "agent.manage");

  return prisma.agent.findMany({
    where: orgScope(actor),
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      commissionRate: true,
      creditLimit: true,
      perNumberLimit: true,
      status: true,
      user: { select: { login: true, displayName: true } },
      _count: { select: { bills: true } },
    },
  });
}

export async function createAgent(actor: Actor, input: AgentInput): Promise<{ agentId: string }> {
  requirePermission(actor, "agent.manage");

  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (code === "") throw new ValidationError("ต้องกรอกรหัส Agent");
  if (name === "") throw new ValidationError("ต้องกรอกชื่อ Agent");

  const commissionRate = parseRate(input.commissionRate);
  const creditLimit = parseOptionalLimit(input.creditLimit, "วงเงินรวมต่อรอบ");
  const perNumberLimit = parseOptionalLimit(input.perNumberLimit, "วงเงินต่อเลข");

  const duplicate = await prisma.agent.findFirst({
    where: { ...orgScope(actor), code },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError(`รหัส Agent "${code}" ถูกใช้ไปแล้ว`);

  const agent = await prisma.$transaction(async (tx) => {
    const created = await tx.agent.create({
      data: {
        organizationId: actor.organizationId,
        code,
        name,
        commissionRate,
        creditLimit,
        perNumberLimit,
      },
      select: { id: true, code: true, name: true, status: true },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: "CREATE",
      entityType: "Agent",
      entityId: created.id,
      after: created,
    });

    return created;
  });

  return { agentId: agent.id };
}

/**
 * เปลี่ยนสถานะ Agent
 *
 * ระงับแล้วต้องตัด session ของผู้ใช้ที่ผูกอยู่ด้วย ไม่งั้นคนที่ login ค้างไว้
 * ยังสร้างบิลต่อได้จนกว่า session จะหมดอายุเอง
 */
export async function setAgentStatus(
  actor: Actor,
  agentId: string,
  status: AgentStatus,
  reason: string,
): Promise<void> {
  requirePermission(actor, "agent.manage");

  const trimmed = reason.trim();
  if (trimmed === "") throw new ValidationError("ต้องระบุเหตุผล");

  const agent = await prisma.agent.findFirst({
    where: { id: agentId, ...orgScope(actor) },
    select: { id: true, status: true, userId: true, code: true },
  });
  if (!agent) throw new NotFoundError("ไม่พบ Agent");
  if (agent.status === status) {
    throw new ConflictError("Agent อยู่ในสถานะนี้อยู่แล้ว");
  }

  await prisma.$transaction(async (tx) => {
    await tx.agent.update({ where: { id: agent.id }, data: { status } });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      action: status === "ACTIVE" ? "REACTIVATE" : "SUSPEND",
      entityType: "Agent",
      entityId: agent.id,
      before: { status: agent.status },
      after: { status },
      reason: trimmed,
    });
  });

  if (status !== "ACTIVE" && agent.userId !== null) {
    await revokeAllSessionsForUser(agent.userId);
  }
}

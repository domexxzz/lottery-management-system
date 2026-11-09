import type { Role, UserStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission, type Actor } from "@/lib/auth/context";
import { hashPassword, validatePasswordStrength } from "@/lib/auth/password";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

export type ManagedRole = Extract<Role, "ADMIN" | "AGENT">;

export type CreateManagedUserInput = {
  login: string;
  displayName: string;
  password: string;
  role: ManagedRole;
  agentCode?: string;
  commissionRate?: string;
  creditLimit?: string;
  perNumberLimit?: string;
};

export type UpdateManagedUserIdentityInput = {
  login: string;
  displayName: string;
  reason: string;
};

function decimal(raw: string | undefined, label: string, optional = false): Prisma.Decimal | null {
  const value = raw?.trim() ?? "";
  if (optional && value === "") return null;
  try {
    const parsed = new Prisma.Decimal(value);
    if (parsed.lessThan(0) || (!optional && label === "อัตราคอมมิชชัน" && parsed.greaterThan(100))) {
      throw new Error();
    }
    if (optional && parsed.lessThanOrEqualTo(0)) throw new Error();
    return parsed;
  } catch {
    throw new ValidationError(optional ? `${label}ต้องมากกว่า 0 หรือเว้นว่าง` : `${label}ต้องอยู่ระหว่าง 0 ถึง 100`);
  }
}

export async function listManagedUsers(actor: Actor) {
  requirePermission(actor, "user.manage");
  return prisma.user.findMany({
    where: {
      organizationId: actor.organizationId,
      ...(actor.role === "GODMODE" ? {} : { role: { in: ["ADMIN", "AGENT"] as Role[] } }),
    },
    orderBy: [{ role: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      login: true,
      displayName: true,
      role: true,
      status: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
      agent: { select: { id: true, code: true, name: true, status: true } },
    },
  });
}

export async function createManagedUser(actor: Actor, input: CreateManagedUserInput): Promise<void> {
  requirePermission(actor, "user.manage");

  const login = input.login.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!/^[a-z0-9._-]{3,64}$/.test(login)) throw new ValidationError("ชื่อผู้ใช้ต้องมี 3–64 ตัว และใช้ a-z, 0-9, จุด ขีดกลาง หรือขีดล่าง");
  if (!displayName) throw new ValidationError("กรุณากรอกชื่อที่ใช้แสดง");
  const passwordError = validatePasswordStrength(input.password);
  if (passwordError) throw new ValidationError(passwordError);
  if (input.role !== "ADMIN" && input.role !== "AGENT") throw new ForbiddenError("Owner กำหนดได้เฉพาะบทบาท Admin หรือ Agent");

  const duplicateLogin = await prisma.user.findUnique({
    where: { organizationId_login: { organizationId: actor.organizationId, login } },
    select: { id: true },
  });
  if (duplicateLogin) throw new ConflictError(`ชื่อผู้ใช้ "${login}" ถูกใช้แล้ว`);

  const passwordHash = await hashPassword(input.password);
  const agentCode = input.agentCode?.trim().toUpperCase() ?? "";
  const commissionRate = input.role === "AGENT" ? decimal(input.commissionRate, "อัตราคอมมิชชัน")! : null;
  const creditLimit = input.role === "AGENT" ? decimal(input.creditLimit, "วงเงินรวมต่องวด", true) : null;
  const perNumberLimit = input.role === "AGENT" ? decimal(input.perNumberLimit, "วงเงินต่อเลข", true) : null;

  if (input.role === "AGENT") {
    if (!agentCode) throw new ValidationError("กรุณากรอกรหัส Agent");
    const duplicateCode = await prisma.agent.findFirst({
      where: { organizationId: actor.organizationId, code: agentCode },
      select: { id: true },
    });
    if (duplicateCode) throw new ConflictError(`รหัส Agent "${agentCode}" ถูกใช้แล้ว`);
  }

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        organizationId: actor.organizationId,
        login,
        displayName,
        passwordHash,
        role: input.role,
        mustChangePassword: true,
      },
      select: { id: true, login: true, displayName: true, role: true, status: true },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "CREATE",
      entityType: "User",
      entityId: user.id,
      after: { login: user.login, displayName: user.displayName, role: user.role, status: user.status },
    });

    if (input.role === "AGENT") {
      const agent = await tx.agent.create({
        data: {
          organizationId: actor.organizationId,
          code: agentCode,
          name: displayName,
          commissionRate: commissionRate!,
          creditLimit,
          perNumberLimit,
          userId: user.id,
        },
        select: { id: true, code: true, name: true, status: true, userId: true },
      });
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: "CREATE",
        entityType: "Agent",
        entityId: agent.id,
        after: agent,
      });
    }
  });
}

export async function setManagedUserStatus(actor: Actor, userId: string, status: UserStatus, reason: string): Promise<void> {
  requirePermission(actor, "user.manage");
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new ValidationError("กรุณาระบุเหตุผล");

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: { id: true, login: true, role: true, status: true, agent: { select: { id: true, status: true } } },
  });
  if (!user) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
  if ((user.role === "GODMODE" || user.role === "OWNER") && actor.role !== "GODMODE") {
    throw new ForbiddenError("เฉพาะ Godmode เท่านั้นที่จัดการบัญชีระดับสูงได้");
  }
  if (user.id === actor.userId && status === "SUSPENDED") {
    throw new ForbiddenError("ไม่สามารถระงับบัญชีที่กำลังใช้งานอยู่ได้");
  }
  if (user.status === status) throw new ConflictError("บัญชีอยู่ในสถานะนี้แล้ว");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status } });
    if (user.agent) {
      await tx.agent.update({
        where: { id: user.agent.id },
        data: { status: status === "ACTIVE" ? "ACTIVE" : "SUSPENDED" },
      });
    }
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: status === "ACTIVE" ? "REACTIVATE" : "SUSPEND",
      entityType: "User",
      entityId: user.id,
      before: { status: user.status },
      after: { status },
      reason: trimmedReason,
    });
  });

  if (status === "SUSPENDED") await revokeAllSessionsForUser(user.id);
}

/**
 * แก้ข้อมูลระบุตัวผู้ใช้ได้เฉพาะ Godmode และบันทึกเหตุผลทุกครั้ง
 * บทบาทไม่ถูกเปลี่ยนที่นี่ เพื่อรักษา Owner ให้เป็นเจ้าของกิจการตามเดิม
 */
export async function updateManagedUserIdentity(
  actor: Actor,
  userId: string,
  input: UpdateManagedUserIdentityInput,
): Promise<void> {
  requirePermission(actor, "system.override");

  const login = input.login.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const reason = input.reason.trim();
  if (!/^[a-z0-9._-]{3,64}$/.test(login)) throw new ValidationError("ชื่อผู้ใช้ต้องมี 3–64 ตัว และใช้ a-z, 0-9, จุด ขีดกลาง หรือขีดล่าง");
  if (!displayName) throw new ValidationError("กรุณากรอกชื่อที่ใช้แสดง");
  if (!reason) throw new ValidationError("กรุณาระบุเหตุผลที่แก้ไข");

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: { id: true, login: true, displayName: true, role: true, agent: { select: { id: true, name: true } } },
  });
  if (!user) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");

  const duplicate = await prisma.user.findFirst({
    where: { organizationId: actor.organizationId, login, id: { not: user.id } },
    select: { id: true },
  });
  if (duplicate) throw new ConflictError(`ชื่อผู้ใช้ "${login}" ถูกใช้แล้ว`);
  if (user.login === login && user.displayName === displayName) throw new ConflictError("ข้อมูลยังไม่มีการเปลี่ยนแปลง");

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { login, displayName } });
    if (user.agent && user.displayName !== displayName) {
      await tx.agent.update({ where: { id: user.agent.id }, data: { name: displayName } });
    }
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      before: { login: user.login, displayName: user.displayName, role: user.role },
      after: { login, displayName, role: user.role },
      reason,
    });
  });
}

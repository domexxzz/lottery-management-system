import type { Role, UserStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission, type Actor } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { agentIdentityAfter, validateOwnerSetPassword } from "./identity";

export type ManagedRole = Extract<Role, "ADMIN" | "AGENT">;

export type CreateManagedUserInput = {
  /** ใช้กับ Admin เท่านั้น — Agent ได้ชื่อผู้ใช้อัตโนมัติ A1, A2, … */
  login?: string;
  displayName: string;
  password: string;
  role: ManagedRole;
  agentCode?: string;
  commissionRate?: string;
  creditLimit?: string;
  perNumberLimit?: string;
};

const AGENT_COMMISSION_RATE = new Prisma.Decimal(30);

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
      deletedAt: null,
      role: { in: ["ADMIN", "AGENT"] as Role[] },
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

/** ชื่อผู้ใช้และรหัส Agent ถัดไปขององค์กร (นับรวมบัญชีที่ถูกซ่อน จึงไม่ใช้เลขของบัญชีที่มีประวัติซ้ำ) */
export async function nextAgentIdentity(
  organizationId: string,
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<{ login: string; code: string }> {
  const [users, agents] = await Promise.all([
    client.user.findMany({ where: { organizationId, login: { startsWith: "a" } }, select: { login: true } }),
    client.agent.findMany({ where: { organizationId, code: { startsWith: "A" } }, select: { code: true } }),
  ]);
  return agentIdentityAfter(users.map((user) => user.login), agents.map((agent) => agent.code));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2003" || error.code === "P2014");
}

/**
 * Owner สร้างบัญชี Admin หรือ Agent
 *
 * - Agent: ชื่อผู้ใช้และรหัส Agent ตั้งอัตโนมัติ (A1, A2, …)
 * - รหัสผ่านตั้งได้ตามต้องการ และไม่บังคับเปลี่ยนตอนเข้าครั้งแรก เพราะ Owner เป็นผู้ดูแลรหัสผ่านให้
 */
export async function createManagedUser(
  actor: Actor,
  input: CreateManagedUserInput,
): Promise<{ login: string; agentCode: string | null }> {
  requirePermission(actor, "user.manage");

  const displayName = input.displayName.trim();
  if (!displayName) throw new ValidationError("กรุณากรอกชื่อที่แสดง");
  const passwordError = validateOwnerSetPassword(input.password);
  if (passwordError) throw new ValidationError(passwordError);
  if (input.role !== "ADMIN" && input.role !== "AGENT") throw new ForbiddenError("Owner กำหนดได้เฉพาะบทบาท Admin หรือ Agent");

  let adminLogin = "";
  if (input.role === "ADMIN") {
    adminLogin = (input.login ?? "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(adminLogin)) throw new ValidationError("ชื่อผู้ใช้ต้องมี 3–64 ตัว และใช้ a-z, 0-9, จุด ขีดกลาง หรือขีดล่าง");
    const duplicateLogin = await prisma.user.findUnique({
      where: { organizationId_login: { organizationId: actor.organizationId, login: adminLogin } },
      select: { id: true },
    });
    if (duplicateLogin) throw new ConflictError(`ชื่อผู้ใช้ "${adminLogin}" ถูกใช้แล้ว`);
  }

  const passwordHash = await hashPassword(input.password);
  // อัตราธุรกิจคงที่ 30% จากยอดเดิมพันรวม ไม่เชื่อค่าที่แก้จากฝั่ง client
  const commissionRate = input.role === "AGENT" ? AGENT_COMMISSION_RATE : null;
  const creditLimit = input.role === "AGENT" ? decimal(input.creditLimit, "วงเงินรวมต่องวด", true) : null;
  const perNumberLimit = input.role === "AGENT" ? decimal(input.perNumberLimit, "วงเงินต่อเลข", true) : null;

  // สร้างพร้อมกันสองคนอาจได้เลขเดียวกัน — unique constraint จะกันไว้ แล้วลองเลขถัดไป
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        const identity = input.role === "AGENT" ? await nextAgentIdentity(actor.organizationId, tx) : null;
        const login = identity?.login ?? adminLogin;
        const user = await tx.user.create({
          data: {
            organizationId: actor.organizationId,
            login,
            displayName,
            passwordHash,
            role: input.role,
            mustChangePassword: false,
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

        if (identity) {
          const agent = await tx.agent.create({
            data: {
              organizationId: actor.organizationId,
              code: identity.code,
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
        return { login, agentCode: identity?.code ?? null };
      });
    } catch (error) {
      if (input.role === "AGENT" && attempt < 3 && isUniqueViolation(error)) continue;
      if (isUniqueViolation(error)) throw new ConflictError("ชื่อผู้ใช้หรือรหัส Agent ถูกใช้แล้ว กรุณาลองอีกครั้ง");
      throw error;
    }
  }
}

/** บัญชีที่ Owner จัดการได้: องค์กรเดียวกัน ยังไม่ถูกลบ และเป็น Admin หรือ Agent */
async function findManageableUser(actor: Actor, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId, deletedAt: null },
    select: {
      id: true,
      login: true,
      displayName: true,
      role: true,
      status: true,
      agent: { select: { id: true, code: true, status: true } },
    },
  });
  if (!user) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
  if (user.role === "OWNER") throw new ForbiddenError("ไม่สามารถจัดการบัญชี Owner จากหน้านี้ได้");
  return user;
}

/**
 * Owner ตั้งรหัสผ่านใหม่ให้บัญชีอื่น
 *
 * ระบบไม่เก็บรหัสผ่านแบบอ่านย้อนได้ Owner เห็นรหัสผ่านตอนตั้งเท่านั้น ลืมก็ตั้งใหม่ได้ทุกเมื่อ
 * บัญชีนั้นถูกออกจากระบบทุกอุปกรณ์ เพื่อให้ต้องใช้รหัสผ่านใหม่ทันที
 */
export async function setManagedUserPassword(actor: Actor, userId: string, password: string): Promise<{ login: string }> {
  requirePermission(actor, "user.manage");
  const passwordError = validateOwnerSetPassword(password);
  if (passwordError) throw new ValidationError(passwordError);
  const user = await findManageableUser(actor, userId);
  if (user.id === actor.userId) throw new ForbiddenError("เปลี่ยนรหัสผ่านของตัวเองได้ที่หน้าเปลี่ยนรหัสผ่าน");

  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      // ไม่บันทึกรหัสผ่านลง Audit
      after: { password: "changed" },
      reason: "Owner ตั้งรหัสผ่านใหม่",
    });
  });
  await revokeAllSessionsForUser(user.id);
  return { login: user.login };
}

/**
 * Owner ลบบัญชี
 *
 * - บัญชีที่ยังไม่มีประวัติ (ไม่เคยเข้าระบบ ไม่มีบิล) ถูกลบจริง
 * - บัญชีที่มีประวัติถูกซ่อน: เข้าระบบไม่ได้และหายจากรายการ แต่บิล รายงาน และ Audit ยังอ้างถึงได้ถูกต้อง
 */
export async function deleteManagedUser(actor: Actor, userId: string): Promise<{ mode: "erased" | "hidden" }> {
  requirePermission(actor, "user.manage");
  const user = await findManageableUser(actor, userId);
  if (user.id === actor.userId) throw new ForbiddenError("ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้");
  const before = {
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    agentCode: user.agent?.code ?? null,
  };

  try {
    await prisma.$transaction(async (tx) => {
      if (user.agent) await tx.agent.delete({ where: { id: user.agent.id } });
      await tx.user.delete({ where: { id: user.id } });
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: "DELETE",
        entityType: "User",
        entityId: user.id,
        before,
        after: { deleted: "erased" },
      });
    });
    return { mode: "erased" };
  } catch (error) {
    // มีข้อมูลอื่นอ้างถึงบัญชีนี้ (บิล ผลรางวัล Audit ฯลฯ) จึงซ่อนแทนการลบจริง
    if (!isForeignKeyViolation(error)) throw error;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { status: "SUSPENDED", deletedAt: new Date() } });
    if (user.agent) await tx.agent.update({ where: { id: user.agent.id }, data: { status: "CLOSED" } });
    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "DELETE",
      entityType: "User",
      entityId: user.id,
      before,
      after: { deleted: "hidden", status: "SUSPENDED" },
    });
  });
  await revokeAllSessionsForUser(user.id);
  return { mode: "hidden" };
}

export async function setManagedUserStatus(actor: Actor, userId: string, status: UserStatus, reason: string): Promise<void> {
  requirePermission(actor, "user.manage");
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new ValidationError("กรุณาระบุเหตุผล");

  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId, deletedAt: null },
    select: { id: true, login: true, role: true, status: true, agent: { select: { id: true, status: true } } },
  });
  if (!user) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
  if (user.role === "OWNER") throw new ForbiddenError("ไม่สามารถจัดการบัญชี Owner จากหน้านี้ได้");
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

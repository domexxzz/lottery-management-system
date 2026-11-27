import type { Role, UserStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission, type Actor } from "@/lib/auth/context";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseDay } from "@/lib/draws/range";
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
  laoCommissionRate?: string;
  creditLimit?: string;
  perNumberLimit?: string;
};

export type UpdateManagedUserInput = {
  displayName: string;
  role: ManagedRole;
  status: UserStatus;
  password?: string;
  agentCode?: string;
  agentName?: string;
  commissionRate?: string;
  laoCommissionRate?: string;
  commissionPromotionStartsOn?: string;
  commissionPromotionEndsOn?: string;
  commissionPromotionThaiMinGross?: string;
  commissionPromotionLaoMinGross?: string;
  commissionPromotionThaiRate?: string;
  commissionPromotionLaoRate?: string;
  creditLimit?: string;
  perNumberLimit?: string;
};

const AGENT_COMMISSION_RATE = new Prisma.Decimal(30);
const AGENT_LAO_COMMISSION_RATE = new Prisma.Decimal(28);

function decimal(raw: string | undefined, label: string, optional = false): Prisma.Decimal | null {
  const value = raw?.trim() ?? "";
  if (optional && value === "") return null;
  try {
    const parsed = new Prisma.Decimal(value);
    if (parsed.lessThan(0) || (!optional && parsed.greaterThan(100))) {
      throw new Error();
    }
    if (optional && parsed.lessThanOrEqualTo(0)) throw new Error();
    return parsed;
  } catch {
    throw new ValidationError(optional ? `${label}ต้องมากกว่า 0 หรือเว้นว่าง` : `${label}ต้องอยู่ระหว่าง 0 ถึง 100`);
  }
}

function commissionPromotion(input: UpdateManagedUserInput) {
  const raw = {
    startsOn: input.commissionPromotionStartsOn?.trim() ?? "",
    endsOn: input.commissionPromotionEndsOn?.trim() ?? "",
    thaiMinGross: input.commissionPromotionThaiMinGross?.trim() ?? "",
    laoMinGross: input.commissionPromotionLaoMinGross?.trim() ?? "",
    thaiRate: input.commissionPromotionThaiRate?.trim() ?? "",
    laoRate: input.commissionPromotionLaoRate?.trim() ?? "",
  };
  const values = Object.values(raw);
  if (values.every((value) => value === "")) {
    return { startsOn: null, endsOn: null, thaiMinGross: null, laoMinGross: null, thaiRate: null, laoRate: null };
  }
  if (!raw.startsOn || !raw.endsOn) throw new ValidationError("กรุณากรอกช่วงวันโปรโมชั่นให้ครบ");
  if (Boolean(raw.thaiMinGross) !== Boolean(raw.thaiRate)) throw new ValidationError("กรุณากรอกยอดขั้นต่ำและค่าคอมหวยรัฐบาลให้ครบทั้งคู่");
  if (Boolean(raw.laoMinGross) !== Boolean(raw.laoRate)) throw new ValidationError("กรุณากรอกยอดขั้นต่ำและค่าคอมหวยลาว Family ให้ครบทั้งคู่");
  if (!raw.thaiMinGross && !raw.laoMinGross) throw new ValidationError("กรุณาตั้งโปรโมชั่นหวยรัฐบาลหรือหวยลาวอย่างน้อยหนึ่งประเภท");
  const startsOn = parseDay(raw.startsOn);
  const endsOn = parseDay(raw.endsOn);
  if (!startsOn || !endsOn) throw new ValidationError("วันที่โปรโมชั่นไม่ถูกต้อง");
  if (endsOn < startsOn) throw new ValidationError("วันสิ้นสุดโปรโมชั่นต้องไม่ก่อนวันเริ่มต้น");
  const thaiMinGross = decimal(raw.thaiMinGross, "ยอดขายขั้นต่ำหวยรัฐบาล", true);
  const laoMinGross = decimal(raw.laoMinGross, "ยอดขายขั้นต่ำหวยลาว Family", true);
  const thaiRate = raw.thaiRate ? decimal(raw.thaiRate, "ค่าคอมโปรโมชั่นหวยรัฐบาล") : null;
  const laoRate = raw.laoRate ? decimal(raw.laoRate, "ค่าคอมโปรโมชั่นหวยลาว Family") : null;
  return {
    startsOn: new Date(`${startsOn}T00:00:00.000Z`),
    endsOn: new Date(`${endsOn}T00:00:00.000Z`),
    thaiMinGross,
    laoMinGross,
    thaiRate,
    laoRate,
  };
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
  const laoCommissionRate = input.role === "AGENT" ? AGENT_LAO_COMMISSION_RATE : null;
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
              laoCommissionRate: laoCommissionRate!,
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
      mustChangePassword: true,
      agent: {
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          commissionRate: true,
          laoCommissionRate: true,
          commissionPromotionStartsOn: true,
          commissionPromotionEndsOn: true,
          commissionPromotionThaiMinGross: true,
          commissionPromotionLaoMinGross: true,
          commissionPromotionThaiRate: true,
          commissionPromotionLaoRate: true,
          creditLimit: true,
          perNumberLimit: true,
        },
      },
    },
  });
  if (!user) throw new NotFoundError("ไม่พบบัญชีผู้ใช้");
  if (user.role === "OWNER") throw new ForbiddenError("ไม่สามารถจัดการบัญชี Owner จากหน้านี้ได้");
  return user;
}

/** อ่านข้อมูลสำหรับหน้าแก้ไข โดยยังใช้ขอบเขตและกฎเดียวกับ mutation */
export async function getManagedUser(actor: Actor, userId: string) {
  requirePermission(actor, "user.manage");
  return findManageableUser(actor, userId);
}

/**
 * Owner แก้ข้อมูลบัญชีได้ทุกช่องที่เกี่ยวกับการใช้งาน ยกเว้น username
 *
 * input จงใจไม่มี login และคำสั่ง update ไม่แตะคอลัมน์ login แม้ client จะส่งค่าเกินมา
 * การเปลี่ยนบทบาท Agent -> Admin จะปิด Agent เดิมไว้เพื่อรักษาบิลและรายงานย้อนหลัง
 */
export async function updateManagedUser(actor: Actor, userId: string, input: UpdateManagedUserInput): Promise<{ login: string }> {
  requirePermission(actor, "user.manage");
  const user = await findManageableUser(actor, userId);
  const displayName = input.displayName.trim();
  if (!displayName) throw new ValidationError("กรุณากรอกชื่อที่แสดง");
  if (input.role !== "ADMIN" && input.role !== "AGENT") throw new ForbiddenError("Owner กำหนดได้เฉพาะบทบาท Admin หรือ Agent");
  if (input.status !== "ACTIVE" && input.status !== "SUSPENDED") throw new ValidationError("สถานะไม่ถูกต้อง");

  // รหัสผ่านเป็นข้อมูลตรงตัว จึงไม่ trim ช่องว่างที่ Owner ตั้งใจใช้
  const password = input.password ?? "";
  if (password) {
    const passwordError = validateOwnerSetPassword(password);
    if (passwordError) throw new ValidationError(passwordError);
  }
  const passwordHash = password ? await hashPassword(password) : undefined;

  const requestedAgentCode = input.agentCode?.trim().toUpperCase() ?? "";
  if (input.role === "AGENT" && requestedAgentCode && !/^[A-Z0-9._-]{1,32}$/.test(requestedAgentCode)) {
    throw new ValidationError("รหัส Agent ใช้ได้เฉพาะ A-Z, 0-9, จุด ขีดกลาง หรือขีดล่าง");
  }
  const agentName = input.agentName?.trim() || displayName;
  const commissionRate = input.role === "AGENT"
    ? decimal(input.commissionRate?.trim() || AGENT_COMMISSION_RATE.toString(), "ค่าคอมหวยรัฐบาล")!
    : null;
  const laoCommissionRate = input.role === "AGENT"
    ? decimal(input.laoCommissionRate?.trim() || AGENT_LAO_COMMISSION_RATE.toString(), "ค่าคอมหวยลาวและหวยลาวชุด")!
    : null;
  const promotion = input.role === "AGENT" ? commissionPromotion(input) : null;
  const creditLimit = input.role === "AGENT" ? decimal(input.creditLimit, "วงเงินรวมต่องวด", true) : null;
  const perNumberLimit = input.role === "AGENT" ? decimal(input.perNumberLimit, "วงเงินต่อเลข", true) : null;
  const before = {
    login: user.login,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    agent: user.agent ? {
      code: user.agent.code,
      name: user.agent.name,
      status: user.agent.status,
      commissionRate: user.agent.commissionRate.toString(),
      laoCommissionRate: user.agent.laoCommissionRate.toString(),
      commissionPromotionStartsOn: user.agent.commissionPromotionStartsOn?.toISOString().slice(0, 10) ?? null,
      commissionPromotionEndsOn: user.agent.commissionPromotionEndsOn?.toISOString().slice(0, 10) ?? null,
      commissionPromotionThaiMinGross: user.agent.commissionPromotionThaiMinGross?.toString() ?? null,
      commissionPromotionLaoMinGross: user.agent.commissionPromotionLaoMinGross?.toString() ?? null,
      commissionPromotionThaiRate: user.agent.commissionPromotionThaiRate?.toString() ?? null,
      commissionPromotionLaoRate: user.agent.commissionPromotionLaoRate?.toString() ?? null,
      creditLimit: user.agent.creditLimit?.toString() ?? null,
      perNumberLimit: user.agent.perNumberLimit?.toString() ?? null,
    } : null,
  };

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          displayName,
          role: input.role,
          status: input.status,
          ...(passwordHash ? { passwordHash } : {}),
        },
      });

      let agentAfter: Prisma.InputJsonObject | null = null;
      if (input.role === "AGENT") {
        const identity = user.agent || requestedAgentCode ? null : await nextAgentIdentity(actor.organizationId, tx);
        const code = requestedAgentCode || user.agent?.code || identity!.code;
        const agentData = {
          code,
          name: agentName,
          commissionRate: commissionRate!,
          laoCommissionRate: laoCommissionRate!,
          commissionPromotionStartsOn: promotion!.startsOn,
          commissionPromotionEndsOn: promotion!.endsOn,
          commissionPromotionThaiMinGross: promotion!.thaiMinGross,
          commissionPromotionLaoMinGross: promotion!.laoMinGross,
          commissionPromotionThaiRate: promotion!.thaiRate,
          commissionPromotionLaoRate: promotion!.laoRate,
          creditLimit,
          perNumberLimit,
          status: input.status === "ACTIVE" ? "ACTIVE" as const : "SUSPENDED" as const,
          userId: user.id,
        };
        if (user.agent) {
          const updatedAgent = await tx.agent.update({ where: { id: user.agent.id }, data: agentData, select: { id: true, code: true, name: true, status: true, commissionRate: true, laoCommissionRate: true, commissionPromotionStartsOn: true, commissionPromotionEndsOn: true, commissionPromotionThaiMinGross: true, commissionPromotionLaoMinGross: true, commissionPromotionThaiRate: true, commissionPromotionLaoRate: true, creditLimit: true, perNumberLimit: true } });
          agentAfter = { ...updatedAgent, commissionRate: updatedAgent.commissionRate.toString(), laoCommissionRate: updatedAgent.laoCommissionRate.toString(), commissionPromotionStartsOn: updatedAgent.commissionPromotionStartsOn?.toISOString().slice(0, 10) ?? null, commissionPromotionEndsOn: updatedAgent.commissionPromotionEndsOn?.toISOString().slice(0, 10) ?? null, commissionPromotionThaiMinGross: updatedAgent.commissionPromotionThaiMinGross?.toString() ?? null, commissionPromotionLaoMinGross: updatedAgent.commissionPromotionLaoMinGross?.toString() ?? null, commissionPromotionThaiRate: updatedAgent.commissionPromotionThaiRate?.toString() ?? null, commissionPromotionLaoRate: updatedAgent.commissionPromotionLaoRate?.toString() ?? null, creditLimit: updatedAgent.creditLimit?.toString() ?? null, perNumberLimit: updatedAgent.perNumberLimit?.toString() ?? null };
        } else {
          const createdAgent = await tx.agent.create({ data: { organizationId: actor.organizationId, ...agentData }, select: { id: true, code: true, name: true, status: true, commissionRate: true, laoCommissionRate: true, commissionPromotionStartsOn: true, commissionPromotionEndsOn: true, commissionPromotionThaiMinGross: true, commissionPromotionLaoMinGross: true, commissionPromotionThaiRate: true, commissionPromotionLaoRate: true, creditLimit: true, perNumberLimit: true } });
          agentAfter = { ...createdAgent, commissionRate: createdAgent.commissionRate.toString(), laoCommissionRate: createdAgent.laoCommissionRate.toString(), commissionPromotionStartsOn: createdAgent.commissionPromotionStartsOn?.toISOString().slice(0, 10) ?? null, commissionPromotionEndsOn: createdAgent.commissionPromotionEndsOn?.toISOString().slice(0, 10) ?? null, commissionPromotionThaiMinGross: createdAgent.commissionPromotionThaiMinGross?.toString() ?? null, commissionPromotionLaoMinGross: createdAgent.commissionPromotionLaoMinGross?.toString() ?? null, commissionPromotionThaiRate: createdAgent.commissionPromotionThaiRate?.toString() ?? null, commissionPromotionLaoRate: createdAgent.commissionPromotionLaoRate?.toString() ?? null, creditLimit: createdAgent.creditLimit?.toString() ?? null, perNumberLimit: createdAgent.perNumberLimit?.toString() ?? null };
        }
      } else if (user.agent) {
        const closedAgent = await tx.agent.update({
          where: { id: user.agent.id },
          data: { userId: null, status: "CLOSED" },
          select: { id: true, code: true, name: true, status: true },
        });
        agentAfter = closedAgent;
      }

      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: "UPDATE",
        entityType: "User",
        entityId: user.id,
        before,
        after: {
          // login แสดงเพื่อยืนยันว่าไม่เปลี่ยน แต่ไม่มีวันรับค่าจากฟอร์ม
          login: user.login,
          displayName,
          role: input.role,
          status: input.status,
          mustChangePassword: user.mustChangePassword,
          password: passwordHash ? "changed" : "unchanged",
          agent: agentAfter,
        },
        reason: "Owner แก้ไขบัญชีผู้ใช้",
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("รหัส Agent นี้ถูกใช้แล้ว");
    throw error;
  }

  if (passwordHash || user.role !== input.role || user.status !== input.status) {
    await revokeAllSessionsForUser(user.id);
  }
  return { login: user.login };
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

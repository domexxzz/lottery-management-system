import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { createSession, revokeAllSessionsForUser } from "./session";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";
import { ValidationError } from "@/lib/errors";

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; mustChangePassword: boolean }
  | { ok: false; message: string };

/**
 * ตรวจรหัสผ่านและเปิด session
 *
 * ข้อความตอบกลับเมื่อไม่ผ่านเป็นข้อความเดียวเสมอ ไม่บอกว่า login ผิดหรือรหัสผ่านผิด
 * เพื่อไม่ให้ใช้หน้านี้ไล่เดาว่ามีบัญชีใดอยู่บ้าง
 */
export async function login(input: {
  organizationId: string;
  loginName: string;
  password: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}): Promise<LoginResult> {
  const GENERIC_FAILURE = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";

  const user = await prisma.user.findUnique({
    where: {
      organizationId_login: {
        organizationId: input.organizationId,
        login: input.loginName,
      },
    },
  });

  if (!user) {
    await writeAudit(prisma, {
      organizationId: input.organizationId,
      actorId: null,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: input.loginName,
      reason: "ไม่พบบัญชีผู้ใช้",
      ipAddress: input.ipAddress,
    });
    return { ok: false, message: GENERIC_FAILURE };
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);

  if (!passwordOk || user.status !== "ACTIVE") {
    await writeAudit(prisma, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "LOGIN_FAILED",
      entityType: "User",
      entityId: user.id,
      reason: passwordOk ? "บัญชีถูกระงับ" : "รหัสผ่านไม่ถูกต้อง",
      ipAddress: input.ipAddress,
    });
    return { ok: false, message: GENERIC_FAILURE };
  }

  const { token, expiresAt } = await createSession({
    userId: user.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await writeAudit(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "LOGIN",
      entityType: "User",
      entityId: user.id,
      ipAddress: input.ipAddress,
    });
  });

  return {
    ok: true,
    token,
    expiresAt,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * เปลี่ยนรหัสผ่าน และตัด session อื่นทั้งหมดของผู้ใช้รายนั้น
 * ใช้ทั้งกรณีบังคับเปลี่ยนครั้งแรก และกรณีผู้ใช้เปลี่ยนเอง
 */
export async function changePassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
  ipAddress?: string | undefined;
}): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  const currentOk = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!currentOk) {
    throw new ValidationError("รหัสผ่านปัจจุบันไม่ถูกต้อง");
  }

  const weakness = validatePasswordStrength(input.newPassword);
  if (weakness) throw new ValidationError(weakness);

  if (input.newPassword === input.currentPassword) {
    throw new ValidationError("รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม");
  }

  const newHash = await hashPassword(input.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    });
    await writeAudit(tx, {
      organizationId: user.organizationId,
      actorId: user.id,
      action: "UPDATE",
      entityType: "User",
      entityId: user.id,
      reason: "เปลี่ยนรหัสผ่าน",
      ipAddress: input.ipAddress,
    });
  });

  // ตัด session ทั้งหมดรวมถึงของตัวเอง ผู้ใช้ต้อง login ใหม่ด้วยรหัสผ่านใหม่
  await revokeAllSessionsForUser(user.id);
}

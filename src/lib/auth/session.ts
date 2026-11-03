import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

const TOKEN_BYTES = 32;

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "lottery_session";

function ttlMinutes(): number {
  const raw = Number(process.env.SESSION_TTL_MINUTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 480;
}

/**
 * เก็บเฉพาะ hash ของ token ลงฐานข้อมูล
 * ถ้าฐานข้อมูลรั่ว ผู้ได้ข้อมูลไปจะสวมรอย session ไม่ได้
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(input: {
  userId: string;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlMinutes() * 60_000);

  await prisma.session.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(token),
      expiresAt,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
  });

  return { token, expiresAt };
}

/**
 * คืนผู้ใช้ของ session ที่ยังใช้ได้
 * ตรวจทั้งอายุ session การถูกเพิกถอน และสถานะผู้ใช้ — ผู้ใช้ที่ถูกระงับใช้ session เดิมต่อไม่ได้
 */
export async function resolveSession(token: string | undefined) {
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt !== null) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  return session;
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** ใช้เมื่อระงับผู้ใช้หรือเปลี่ยนรหัสผ่าน — ตัด session ที่ค้างอยู่ทั้งหมด */
export async function revokeAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  };
}

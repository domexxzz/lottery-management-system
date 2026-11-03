"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { login } from "@/lib/auth/login";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/auth/session";

const LoginInput = z.object({
  login: z.string().trim().min(1, "กรุณากรอกชื่อผู้ใช้").max(64),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน").max(256),
});

export type LoginState = { error: string | null };

/**
 * P1 ใช้องค์กรเดียวก่อน จึงเลือกองค์กรที่ active รายแรก
 * เมื่อรองรับหลายองค์กรจริง ให้ตัดสินจาก subdomain หรือรหัสองค์กรในฟอร์มแทน
 */
async function resolveOrganizationId(): Promise<string | null> {
  const org = await prisma.organization.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return org?.id ?? null;
}

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = LoginInput.safeParse({
    login: formData.get("login"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  const organizationId = await resolveOrganizationId();
  if (!organizationId) {
    return { error: "ยังไม่ได้ตั้งค่าองค์กรในระบบ กรุณารัน seed ก่อน" };
  }

  const h = await headers();
  const result = await login({
    organizationId,
    loginName: parsed.data.login,
    password: parsed.data.password,
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim(),
    userAgent: h.get("user-agent") ?? undefined,
  });

  if (!result.ok) {
    return { error: result.message };
  }

  (await cookies()).set(
    SESSION_COOKIE_NAME,
    result.token,
    sessionCookieOptions(result.expiresAt),
  );

  redirect(result.mustChangePassword ? "/change-password" : "/");
}

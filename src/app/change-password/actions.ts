"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import { changePassword } from "@/lib/auth/login";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";

const Input = z.object({
  currentPassword: z.string().min(1, "กรุณากรอกรหัสผ่านปัจจุบัน").max(256),
  newPassword: z.string().min(1, "กรุณากรอกรหัสผ่านใหม่").max(256),
  confirmPassword: z.string().max(256),
});

export type ChangePasswordState = { error: string | null };

export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const actor = await requireActor();

  const parsed = Input.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { error: "รหัสผ่านใหม่และการยืนยันไม่ตรงกัน" };
  }

  try {
    await changePassword({
      userId: actor.userId,
      currentPassword: parsed.data.currentPassword,
      newPassword: parsed.data.newPassword,
      ipAddress: actor.ipAddress,
      requestId: actor.requestId,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return { error: error.message };
    }
    throw error;
  }

  // changePassword ตัด session ทั้งหมดแล้ว ต้อง login ใหม่ด้วยรหัสผ่านใหม่
  (await cookies()).delete(SESSION_COOKIE_NAME);
  redirect("/login");
}

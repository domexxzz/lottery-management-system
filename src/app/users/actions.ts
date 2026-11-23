"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { displayLogin } from "@/lib/users/identity";
import {
  createManagedUser,
  deleteManagedUser,
  setManagedUserPassword,
  setManagedUserStatus,
  updateManagedUser,
} from "@/lib/users/service";

/**
 * credentials: ชื่อผู้ใช้และรหัสผ่านที่ Owner เพิ่งตั้ง แสดงให้ดูและคัดลอกได้ทันที
 * ระบบไม่เก็บรหัสผ่านแบบอ่านย้อนได้ จึงเห็นได้เฉพาะตอนตั้งเท่านั้น
 */
export type UserActionState = {
  error: string | null;
  ok: boolean;
  message?: string;
  credentials?: { login: string; password: string };
};

const CreateUserSchema = z.object({
  login: z.string().trim().max(64).optional(),
  displayName: z.string().trim().min(1, "กรุณากรอกชื่อที่แสดง").max(120),
  password: z.string().min(1, "กรุณากรอกรหัสผ่าน").max(256),
  role: z.enum(["ADMIN", "AGENT"]),
  creditLimit: z.string().max(20).optional(),
  perNumberLimit: z.string().max(20).optional(),
});

const UpdateUserSchema = z.object({
  userId: z.string().min(1),
  displayName: z.string().trim().min(1, "กรุณากรอกชื่อที่แสดง").max(120),
  role: z.enum(["ADMIN", "AGENT"]),
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  password: z.string().max(256).optional(),
  agentCode: z.string().trim().max(32).optional(),
  agentName: z.string().trim().max(120).optional(),
  commissionRate: z.string().max(20).optional(),
  laoCommissionRate: z.string().max(20).optional(),
  commissionPromotionStartsOn: z.string().max(10).optional(),
  commissionPromotionEndsOn: z.string().max(10).optional(),
  commissionPromotionMinGross: z.string().max(20).optional(),
  commissionPromotionThaiRate: z.string().max(20).optional(),
  commissionPromotionLaoRate: z.string().max(20).optional(),
  creditLimit: z.string().max(20).optional(),
  perNumberLimit: z.string().max(20).optional(),
});

function fail(error: unknown): UserActionState {
  if (error instanceof AppError) return { error: error.message, ok: false };
  throw error;
}

function refresh() {
  revalidatePath("/users");
  revalidatePath("/agents");
}

export async function updateUserAction(_previous: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await requireActor();
  const parsed = UpdateUserSchema.safeParse({
    userId: formData.get("userId"),
    displayName: formData.get("displayName"),
    role: formData.get("role"),
    status: formData.get("status"),
    password: formData.get("password") ?? "",
    agentCode: formData.get("agentCode") ?? "",
    agentName: formData.get("agentName") ?? "",
    commissionRate: formData.get("commissionRate") ?? "",
    laoCommissionRate: formData.get("laoCommissionRate") ?? "",
    commissionPromotionStartsOn: formData.get("commissionPromotionStartsOn") ?? "",
    commissionPromotionEndsOn: formData.get("commissionPromotionEndsOn") ?? "",
    commissionPromotionMinGross: formData.get("commissionPromotionMinGross") ?? "",
    commissionPromotionThaiRate: formData.get("commissionPromotionThaiRate") ?? "",
    commissionPromotionLaoRate: formData.get("commissionPromotionLaoRate") ?? "",
    creditLimit: formData.get("creditLimit") ?? "",
    perNumberLimit: formData.get("perNumberLimit") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง", ok: false };
  try {
    const updated = await updateManagedUser(actor, parsed.data.userId, parsed.data);
    refresh();
    revalidatePath(`/users/${parsed.data.userId}/edit`);
    return {
      error: null,
      ok: true,
      message: "บันทึกข้อมูลผู้ใช้แล้ว",
      ...(parsed.data.password
        ? { credentials: { login: displayLogin(updated.login), password: parsed.data.password } }
        : {}),
    };
  } catch (error) {
    return fail(error);
  }
}

export async function createUserAction(_previous: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await requireActor();
  const parsed = CreateUserSchema.safeParse({
    login: formData.get("login") ?? "",
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    role: formData.get("role"),
    creditLimit: formData.get("creditLimit") ?? "",
    perNumberLimit: formData.get("perNumberLimit") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง", ok: false };
  try {
    const created = await createManagedUser(actor, parsed.data);
    refresh();
    return {
      error: null,
      ok: true,
      message: `สร้างบัญชี ${parsed.data.displayName} แล้ว${created.agentCode ? ` · รหัส Agent ${created.agentCode}` : ""}`,
      credentials: { login: displayLogin(created.login), password: parsed.data.password },
    };
  } catch (error) {
    return fail(error);
  }
}

export async function setUserPasswordAction(_previous: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await requireActor();
  const password = String(formData.get("password") ?? "");
  try {
    const { login } = await setManagedUserPassword(actor, String(formData.get("userId") ?? ""), password);
    refresh();
    return { error: null, ok: true, message: "ตั้งรหัสผ่านใหม่แล้ว", credentials: { login: displayLogin(login), password } };
  } catch (error) {
    return fail(error);
  }
}

export async function deleteUserAction(_previous: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await requireActor();
  try {
    const { mode } = await deleteManagedUser(actor, String(formData.get("userId") ?? ""));
    refresh();
    return { error: null, ok: true, message: mode === "erased" ? "ลบบัญชีแล้ว" : "ลบบัญชีแล้ว (เก็บประวัติบิลไว้)" };
  } catch (error) {
    return fail(error);
  }
}

export async function setUserStatusAction(_previous: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await requireActor();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "");
  if (status !== "ACTIVE" && status !== "SUSPENDED") return { error: "สถานะไม่ถูกต้อง", ok: false };
  try {
    await setManagedUserStatus(actor, userId, status, reason);
  } catch (error) {
    return fail(error);
  }
  refresh();
  return { error: null, ok: true };
}

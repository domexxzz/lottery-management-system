"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { createManagedUser, setManagedUserStatus } from "@/lib/users/service";

export type UserActionState = { error: string | null; ok: boolean };

const CreateUserSchema = z.object({
  login: z.string().trim().min(3).max(64),
  displayName: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(256),
  role: z.enum(["ADMIN", "AGENT"]),
  agentCode: z.string().max(20).optional(),
  commissionRate: z.string().max(20).optional(),
  creditLimit: z.string().max(20).optional(),
  perNumberLimit: z.string().max(20).optional(),
});

export async function createUserAction(_previous: UserActionState, formData: FormData): Promise<UserActionState> {
  const actor = await requireActor();
  const parsed = CreateUserSchema.safeParse({
    login: formData.get("login"),
    displayName: formData.get("displayName"),
    password: formData.get("password"),
    role: formData.get("role"),
    agentCode: formData.get("agentCode") ?? "",
    commissionRate: formData.get("commissionRate") ?? "",
    creditLimit: formData.get("creditLimit") ?? "",
    perNumberLimit: formData.get("perNumberLimit") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง", ok: false };
  try {
    await createManagedUser(actor, parsed.data);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, ok: false };
    throw error;
  }
  revalidatePath("/users");
  revalidatePath("/agents");
  return { error: null, ok: true };
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
    if (error instanceof AppError) return { error: error.message, ok: false };
    throw error;
  }
  revalidatePath("/users");
  revalidatePath("/agents");
  return { error: null, ok: true };
}

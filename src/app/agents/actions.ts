"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import { createAgent, setAgentStatus } from "@/lib/agents/service";
import { AppError } from "@/lib/errors";

export type ActionState = { error: string | null; ok: boolean };

const CreateSchema = z.object({
  code: z.string().trim().min(1, "กรุณากรอกรหัส Agent").max(20),
  name: z.string().trim().min(1, "กรุณากรอกชื่อ Agent").max(120),
  commissionRate: z.string().trim().min(1, "กรุณากรอกอัตราคอมมิชชัน"),
  creditLimit: z.string().max(20),
  perNumberLimit: z.string().max(20),
});

export async function createAgentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();

  const parsed = CreateSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
    commissionRate: formData.get("commissionRate"),
    creditLimit: formData.get("creditLimit") ?? "",
    perNumberLimit: formData.get("perNumberLimit") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง", ok: false };
  }

  try {
    await createAgent(actor, parsed.data);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, ok: false };
    throw error;
  }

  revalidatePath("/agents");
  return { error: null, ok: true };
}

export async function setAgentStatusAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const agentId = String(formData.get("agentId") ?? "");
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "");

  if (status !== "ACTIVE" && status !== "SUSPENDED" && status !== "CLOSED") {
    return { error: "สถานะไม่ถูกต้อง", ok: false };
  }

  try {
    await setAgentStatus(actor, agentId, status, reason);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, ok: false };
    throw error;
  }

  revalidatePath("/agents");
  return { error: null, ok: true };
}

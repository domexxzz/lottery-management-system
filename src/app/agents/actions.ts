"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/context";
import { setAgentStatus } from "@/lib/agents/service";
import { AppError } from "@/lib/errors";

export type ActionState = { error: string | null; ok: boolean };

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

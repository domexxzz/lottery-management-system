"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { markAgentCommissionPaid, unmarkAgentCommissionPaid } from "@/lib/reports/commission-payment";

export type CommissionPaymentActionState = { error: string | null; message: string | null };

export async function setCommissionPaidAction(
  _previous: CommissionPaymentActionState,
  formData: FormData,
): Promise<CommissionPaymentActionState> {
  const actor = await requireActor();
  const agentId = String(formData.get("agentId") ?? "");
  const month = String(formData.get("month") ?? "");
  const paid = formData.get("paid") === "true";
  try {
    if (paid) {
      await markAgentCommissionPaid(actor, { agentId, month, note: String(formData.get("note") ?? "") });
    } else {
      await unmarkAgentCommissionPaid(actor, { agentId, month });
    }
    revalidatePath("/reports/commissions");
    revalidatePath("/reports");
    return { error: null, message: paid ? "บันทึกว่าจ่ายค่าคอมแล้ว" : "ยกเลิกเครื่องหมายแล้ว" };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, message: null };
    throw error;
  }
}

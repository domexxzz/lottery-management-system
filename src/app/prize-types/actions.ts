"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/context";
import { updatePrizeType } from "@/lib/prizeTypes/service";
import { AppError } from "@/lib/errors";

export type ActionState = { error: string | null; message: string | null };

export async function updatePrizeTypeAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const prizeTypeId = String(formData.get("prizeTypeId") ?? "");

  try {
    await updatePrizeType(
      actor,
      prizeTypeId,
      {
        name: String(formData.get("name") ?? ""),
        digits: String(formData.get("digits") ?? ""),
        isPermutation: formData.get("isPermutation") === "on",
        payoutRate: String(formData.get("payoutRate") ?? ""),
        maxStakePerItem: String(formData.get("maxStakePerItem") ?? ""),
        isActive: formData.get("isActive") === "on",
      },
      String(formData.get("reason") ?? ""),
    );
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, message: null };
    throw error;
  }

  revalidatePath("/prize-types");
  return { error: null, message: "บันทึกแล้ว" };
}

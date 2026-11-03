"use server";

import { revalidatePath } from "next/cache";
import type { MatchRule } from "@prisma/client";
import { requireActor } from "@/lib/auth/context";
import { updatePrizeType } from "@/lib/prizeTypes/service";
import { AppError } from "@/lib/errors";

export type ActionState = { error: string | null; message: string | null };

const MATCH_RULES = ["EXACT", "PERMUTATION", "CONTAINS_DIGIT"] as const;

/** ค่าที่มาจากฟอร์มเป็น string ดิบ ต้องตรวจก่อนส่งต่อเป็น enum */
function readMatchRule(raw: FormDataEntryValue | null): MatchRule {
  const value = String(raw ?? "");
  return (MATCH_RULES as readonly string[]).includes(value) ? (value as MatchRule) : "EXACT";
}

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
        matchRule: readMatchRule(formData.get("matchRule")),
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

"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/context";
import { approveResult, enterResult, rejectResult } from "@/lib/results/service";
import {
  approveSettlement,
  calculateSettlement,
  reconcileSettlement,
} from "@/lib/settlement/service";
import { AppError } from "@/lib/errors";

export type ActionState = { error: string | null; message: string | null };

function fail(error: unknown): ActionState {
  if (error instanceof AppError) return { error: error.message, message: null };
  throw error;
}

export async function enterResultAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    await enterResult(actor, {
      drawId,
      prizeTypeId: String(formData.get("prizeTypeId") ?? ""),
      value: String(formData.get("value") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/draws/${drawId}`);
  return { error: null, message: "บันทึกผลแล้ว รอผู้ตรวจอนุมัติ" };
}

export async function approveResultAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    await approveResult(actor, String(formData.get("resultId") ?? ""));
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/draws/${drawId}`);
  return { error: null, message: "อนุมัติผลแล้ว" };
}

export async function rejectResultAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    await rejectResult(
      actor,
      String(formData.get("resultId") ?? ""),
      String(formData.get("reason") ?? ""),
    );
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/draws/${drawId}`);
  return { error: null, message: "ตีกลับผลแล้ว" };
}

export async function calculateSettlementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    const previews = await calculateSettlement(actor, drawId);
    revalidatePath(`/draws/${drawId}`);
    return { error: null, message: `คำนวณแล้ว ${previews.length} Agent` };
  } catch (error) {
    return fail(error);
  }
}

export async function reconcileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    await reconcileSettlement(actor, String(formData.get("settlementId") ?? ""));
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/draws/${drawId}`);
  return { error: null, message: "กระทบยอดแล้ว" };
}

export async function approveSettlementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    await approveSettlement(actor, drawId);
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/draws/${drawId}`);
  return { error: null, message: "ปิดบัญชีรอบแล้ว" };
}

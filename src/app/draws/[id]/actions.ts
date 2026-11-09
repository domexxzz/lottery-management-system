"use server";

import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/context";
import {
  approveResult,
  enterResult,
  enterResultsBatch,
  proposeResultCorrection,
  rejectResult,
} from "@/lib/results/service";
import {
  approveSettlement,
  calculateSettlement,
  reconcileSettlement,
} from "@/lib/settlement/service";
import { AppError } from "@/lib/errors";
import { addRestriction, removeRestriction } from "@/lib/draws/restrictions";

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
  let autoApproved = false;

  try {
    const outcome = await enterResult(actor, {
      drawId,
      prizeTypeId: String(formData.get("prizeTypeId") ?? ""),
      value: String(formData.get("value") ?? ""),
    });
    autoApproved = outcome.autoApproved;
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/draws/${drawId}`);
  return {
    error: null,
    message: autoApproved ? "บันทึกและยืนยันผลแล้ว" : "บันทึกผลแล้ว",
  };
}

export async function enterResultsBatchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");
  const grouped = new Map<string, string[]>();
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("result:")) continue;
    const value = String(rawValue).trim();
    if (value === "") continue;
    const prizeTypeId = key.slice("result:".length);
    grouped.set(prizeTypeId, [...(grouped.get(prizeTypeId) ?? []), value]);
  }
  const results = [...grouped].map(([prizeTypeId, values]) => ({ prizeTypeId, values }));

  let count = 0;
  try {
    const outcome = await enterResultsBatch(actor, { drawId, results });
    count = outcome.count;
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/draws/${drawId}`);
  return { error: null, message: `บันทึกและยืนยันผลแล้ว ${count} รายการ` };
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

export async function proposeResultCorrectionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    await proposeResultCorrection(actor, {
      drawId,
      prizeTypeId: String(formData.get("prizeTypeId") ?? ""),
      values: formData.getAll("value").map(String),
      reason: String(formData.get("reason") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/draws/${drawId}`);
  return { error: null, message: "ส่งคำขอแก้ผลแล้ว รอ Owner อนุมัติ" };
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
  revalidatePath("/draws");
  return { error: null, message: "ตรวจสอบยอดแล้ว" };
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
  return { error: null, message: "ปิดบัญชีงวดแล้ว" };
}

export async function addRestrictionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");
  const kind = formData.get("kind") === "REDUCED_RATE" ? "REDUCED_RATE" : "CLOSED";
  try {
    await addRestriction(actor, {
      drawId,
      prizeTypeId: String(formData.get("prizeTypeId") ?? ""),
      number: String(formData.get("number") ?? ""),
      kind,
      payoutRate: String(formData.get("payoutRate") ?? ""),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath(`/draws/${drawId}`);
  revalidatePath("/bills/new");
  return { error: null, message: kind === "CLOSED" ? "บันทึกเลขเต็มแล้ว" : "บันทึกเลขอั้นแล้ว" };
}

export async function removeRestrictionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireActor();
  try {
    const { drawId } = await removeRestriction(actor, String(formData.get("restrictionId") ?? ""));
    revalidatePath(`/draws/${drawId}`);
    revalidatePath("/bills/new");
  } catch (error) {
    return fail(error);
  }
  return { error: null, message: "ยกเลิกแล้ว" };
}

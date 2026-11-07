"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import {
  cancelBill,
  confirmBill,
  createDraftBill,
  replaceDraftItems,
  requestCancelAfterCutoff,
} from "@/lib/bills/service";
import { AppError } from "@/lib/errors";

export type ActionState = { error: string | null };

const ItemSchema = z.object({
  prizeTypeId: z.string().min(1),
  number: z.string().trim().min(1).max(12),
  stake: z.string().trim().min(1).max(20),
});

const CreateSchema = z.object({
  drawId: z.string().min(1, "กรุณาเลือกรอบ"),
  agentId: z.string().min(1, "กรุณาเลือก Agent").optional(),
  title: z.string().trim().min(1, "กรุณากรอกชื่อบิล").max(120),
  items: z.array(ItemSchema).min(1, "บิลต้องมีอย่างน้อยหนึ่งรายการ"),
});

/** แปลง FormData ที่มีหลายแถวเป็น array ของรายการ */
function readItems(formData: FormData) {
  const prizeTypeIds = formData.getAll("prizeTypeId").map(String);
  const numbers = formData.getAll("number").map(String);
  const stakes = formData.getAll("stake").map(String);

  return prizeTypeIds
    .map((prizeTypeId, i) => ({
      prizeTypeId,
      number: numbers[i] ?? "",
      stake: stakes[i] ?? "",
    }))
    // แถวที่ผู้ใช้เว้นว่างไว้ ไม่ถือเป็นรายการ
    .filter((row) => row.number.trim() !== "" || row.stake.trim() !== "");
}

export async function createBillAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();

  const parsed = CreateSchema.safeParse({
    drawId: formData.get("drawId"),
    agentId: formData.get("agentId") || undefined,
    title: formData.get("title"),
    items: readItems(formData),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  }

  let billId: string;
  try {
    const created = await createDraftBill(actor, {
      drawId: parsed.data.drawId,
      agentId: parsed.data.agentId,
      title: parsed.data.title,
    });
    billId = created.billId;
    await replaceDraftItems(actor, billId, parsed.data.items);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  redirect(`/bills/${billId}`);
}

export async function confirmBillAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const billId = String(formData.get("billId") ?? "");

  try {
    await confirmBill(actor, billId);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/bills/${billId}`);
  revalidatePath("/bills");
  redirect("/bills");
}

export async function requestCancelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const billId = String(formData.get("billId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    await requestCancelAfterCutoff(actor, billId, reason);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/bills/${billId}`);
  return { error: null };
}

export async function cancelBillAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const billId = String(formData.get("billId") ?? "");
  const reason = String(formData.get("reason") ?? "");

  try {
    await cancelBill(actor, billId, reason);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/bills/${billId}`);
  return { error: null };
}

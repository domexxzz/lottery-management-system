"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import {
  cancelBill,
  confirmBill,
  createDraftBill,
  deleteBillPermanently,
  placeBill,
  replaceDraftItems,
  requestCancelAfterCutoff,
} from "@/lib/bills/service";
import { AppError } from "@/lib/errors";
import { MAX_STAKE_PER_ITEM } from "@/lib/bills/betting";

export type ActionState = { error: string | null };

const ItemSchema = z.object({
  prizeTypeId: z.string().min(1),
  number: z.string().trim().min(1).max(12),
  stake: z.string().trim().min(1).max(20),
});

const CreateSchema = z.object({
  drawId: z.string().min(1, "กรุณาเลือกงวด"),
  agentId: z.string().min(1, "กรุณาเลือก Agent").optional(),
  representativeUserId: z.string().min(1, "กรุณาเลือกผู้รับบิล").optional(),
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
    representativeUserId: formData.get("representativeUserId") || undefined,
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
      representativeUserId: parsed.data.representativeUserId,
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

export async function deleteBillAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const billId = String(formData.get("billId") ?? "");

  try {
    await deleteBillPermanently(actor, billId);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath("/bills");
  revalidatePath("/draws");
  revalidatePath("/reports");
  redirect("/bills");
}

const PlaceSchema = z.object({
  drawId: z.string().min(1, "ไม่พบงวดที่เปิดรับ"),
  title: z.string().trim().min(1, "กรุณากรอกชื่อลูกค้า").max(120),
  items: z
    .array(
      z.object({
        prizeTypeId: z.string().min(1),
        number: z.string().regex(/^\d{1,6}$/, "เลขไม่ถูกต้อง"),
        stake: z.number().int("ยอดเดิมพันต้องเป็นจำนวนเต็ม").positive("ยอดเดิมพันต้องมากกว่า 0").max(MAX_STAKE_PER_ITEM, "ยอดเดิมพันต่อรายการต้องไม่เกิน 1,000 บาท"),
      }),
    )
    .min(1, "ยังไม่มีรายการแทง")
    .max(500, "รายการในโพยเดียวต้องไม่เกิน 500 รายการ"),
});

function readSlip(formData: FormData) {
  let rawItems: unknown;
  try {
    rawItems = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "รายการแทงไม่ถูกต้อง" } as const;
  }
  const parsed = PlaceSchema.safeParse({
    drawId: formData.get("drawId"),
    title: formData.get("title"),
    items: rawItems,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" } as const;
  const representativeUserId = String(formData.get("representativeUserId") ?? "").trim() || undefined;
  return {
    data: {
      ...parsed.data,
      representativeUserId,
      items: parsed.data.items.map((item) => ({ ...item, stake: String(item.stake) })),
    },
  } as const;
}

/** หน้าสร้างบิล: สร้างและยืนยันบิลในขั้นตอนเดียว */
export async function placeBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireActor();
  const slip = readSlip(formData);
  if ("error" in slip) return { error: slip.error ?? "ข้อมูลไม่ถูกต้อง" };

  let billId: string;
  try {
    const placed = await placeBill(actor, slip.data);
    billId = placed.billId;
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath("/bills");
  redirect(`/bills/${billId}?placed=1#bill-evidence`);
}

/** หน้าสร้างบิล: บันทึกเป็นร่างไว้ก่อน แก้หรือยืนยันภายหลังได้จากหน้ารายละเอียด */
export async function saveDraftBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireActor();
  const slip = readSlip(formData);
  if ("error" in slip) return { error: slip.error ?? "ข้อมูลไม่ถูกต้อง" };

  let billId: string;
  try {
    const created = await createDraftBill(actor, {
      drawId: slip.data.drawId,
      title: slip.data.title,
      representativeUserId: actor.role === "AGENT" ? undefined : slip.data.representativeUserId,
    });
    billId = created.billId;
    await replaceDraftItems(actor, billId, slip.data.items);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath("/bills");
  redirect(`/bills/${billId}`);
}

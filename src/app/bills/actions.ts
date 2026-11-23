"use server";

import { redirect } from "next/navigation";
import { refresh, revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import {
  confirmBill,
  createDraftBill,
  deleteBillItemBeforeCutoff,
  placeSlip,
  replaceDraftItems,
  softDeleteBillBeforeCutoff,
  updateBillBeforeCutoff,
  updateBillItemBeforeCutoff,
} from "@/lib/bills/service";
import { AppError, BillItemsRejectedError, type RejectedBillItem } from "@/lib/errors";
import { MAX_STAKE_PER_ITEM } from "@/lib/bills/betting";

export type ActionState = {
  error: string | null;
  saved?: boolean;
  /** เลขที่ Server ปฏิเสธตอนยืนยัน (เช่นเลขเต็มระหว่างกรอก) หน้าสร้างบิลใช้ไฮไลต์รายการที่ต้องแก้ */
  rejected?: RejectedBillItem[];
};

const ItemSchema = z.object({
  prizeTypeId: z.string().min(1),
  number: z.string().trim().min(1).max(12),
  stake: z.string().trim().min(1).max(20),
  quantity: z.coerce.number().int("จำนวนชุดต้องเป็นจำนวนเต็ม").min(1, "จำนวนชุดต้องอย่างน้อย 1").max(999, "จำนวนชุดต้องไม่เกิน 999").optional().default(1),
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
  const quantities = formData.getAll("quantity").map(String);

  return prizeTypeIds
    .map((prizeTypeId, i) => ({
      prizeTypeId,
      number: numbers[i] ?? "",
      stake: stakes[i] ?? "",
      quantity: quantities[i] || "1",
    }))
    // แถวที่ผู้ใช้เว้นว่างไว้ ไม่ถือเป็นรายการ
    .filter((row) => row.number.trim() !== "" || row.stake.trim() !== "");
}

export async function updateBillItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireActor();
  const parsed = z.object({
    billId: z.string().min(1),
    itemId: z.string().min(1),
    number: z.string().trim().regex(/^\d{1,6}$/, "เลขที่แทงไม่ถูกต้อง"),
    stake: z.string().trim().min(1),
    quantity: z.coerce.number().int().min(1).max(999).optional().default(1),
  }).safeParse({
    billId: formData.get("billId"), itemId: formData.get("itemId"), number: formData.get("number"),
    stake: formData.get("stake"), quantity: formData.get("quantity") || "1",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };
  try {
    await updateBillItemBeforeCutoff(actor, parsed.data.billId, parsed.data.itemId, parsed.data);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/bills/${parsed.data.billId}`);
  revalidatePath("/bills");
  revalidatePath("/reports");
  refresh();
  return { error: null, saved: true };
}

export async function deleteBillItemAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireActor();
  const billId = String(formData.get("billId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  try {
    await deleteBillItemBeforeCutoff(actor, billId, itemId);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }
  revalidatePath(`/bills/${billId}`);
  revalidatePath("/bills");
  revalidatePath("/reports");
  refresh();
  return { error: null, saved: true };
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

export async function deleteBillAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const billId = String(formData.get("billId") ?? "");

  try {
    await softDeleteBillBeforeCutoff(actor, billId);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath("/bills");
  revalidatePath("/draws");
  revalidatePath("/reports");
  redirect("/bills");
}

export async function updateBillAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const billId = String(formData.get("billId") ?? "");
  const parsed = z.object({
    title: z.string().trim().min(1, "กรุณากรอกชื่อลูกค้า").max(120),
    items: z.array(ItemSchema).min(1, "บิลต้องมีอย่างน้อยหนึ่งรายการ"),
  }).safeParse({ title: formData.get("title"), items: readItems(formData) });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" };

  try {
    await updateBillBeforeCutoff(actor, billId, parsed.data);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath(`/bills/${billId}`);
  revalidatePath("/bills");
  revalidatePath("/reports");
  return { error: null };
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
        quantity: z.number().int("จำนวนชุดต้องเป็นจำนวนเต็ม").min(1, "จำนวนชุดต้องอย่างน้อย 1").max(999, "จำนวนชุดต้องไม่เกิน 999").optional().default(1),
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
  // รหัสสุ่มจาก browser กันบิลซ้ำ รับเฉพาะรูปแบบที่คาดไว้ ค่าแปลกถือว่าไม่ได้ส่งมา
  const rawKey = String(formData.get("submissionKey") ?? "").trim();
  const submissionKey = /^[A-Za-z0-9-]{16,64}$/.test(rawKey) ? rawKey : undefined;
  return {
    data: {
      ...parsed.data,
      representativeUserId,
      submissionKey,
      items: parsed.data.items.map((item) => ({ ...item, stake: String(item.stake) })),
    },
  } as const;
}

const SlipItemSchema = z.object({
  prizeTypeId: z.string().min(1),
  number: z.string().regex(/^\d{1,6}$/, "เลขไม่ถูกต้อง"),
  stake: z.number().int("ยอดเดิมพันต้องเป็นจำนวนเต็ม").positive("ยอดเดิมพันต้องมากกว่า 0").max(MAX_STAKE_PER_ITEM, "ยอดเดิมพันต่อรายการต้องไม่เกิน 1,000 บาท"),
  quantity: z.number().int("จำนวนชุดต้องเป็นจำนวนเต็ม").min(1, "จำนวนชุดต้องอย่างน้อย 1").max(999, "จำนวนชุดต้องไม่เกิน 999").optional().default(1),
});

/** บิลเดียวหลายประเภทหวย: รายการแยกตามงวด */
const PartsSchema = z
  .array(z.object({ drawId: z.string().min(1, "ไม่พบงวดที่เปิดรับ"), items: z.array(SlipItemSchema) }))
  .min(1, "ยังไม่มีรายการแทง")
  .max(6, "บิลเดียวรวมได้ไม่เกิน 6 งวด")
  .refine((parts) => parts.some((part) => part.items.length > 0), "ยังไม่มีรายการแทง")
  .refine((parts) => parts.reduce((sum, part) => sum + part.items.length, 0) <= 500, "รายการในโพยเดียวต้องไม่เกิน 500 รายการ");

/**
 * อ่านบิลจากหน้าสร้างบิล
 * หน้าใหม่ส่ง parts (หลายประเภทหวยได้) ฟอร์มเดิมส่ง drawId + items ประเภทเดียว
 */
function readSlipParts(formData: FormData) {
  const rawParts = formData.get("parts");
  if (rawParts === null) {
    const single = readSlip(formData);
    if (!("data" in single) || !single.data) return { error: ("error" in single ? single.error : undefined) ?? "ข้อมูลไม่ถูกต้อง" } as const;
    const { drawId, items, ...rest } = single.data;
    return { data: { ...rest, parts: [{ drawId, items }] } } as const;
  }
  let parts: unknown;
  try {
    parts = JSON.parse(String(rawParts));
  } catch {
    return { error: "รายการแทงไม่ถูกต้อง" } as const;
  }
  const parsedParts = PartsSchema.safeParse(parts);
  if (!parsedParts.success) return { error: parsedParts.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" } as const;
  const title = String(formData.get("title") ?? "").trim();
  if (title.length === 0) return { error: "กรุณากรอกชื่อลูกค้า" } as const;
  if (title.length > 120) return { error: "ชื่อลูกค้ายาวเกินไป" } as const;
  const representativeUserId = String(formData.get("representativeUserId") ?? "").trim() || undefined;
  const rawKey = String(formData.get("submissionKey") ?? "").trim();
  const submissionKey = /^[A-Za-z0-9-]{16,64}$/.test(rawKey) ? rawKey : undefined;
  return {
    data: {
      title,
      representativeUserId,
      submissionKey,
      parts: parsedParts.data.map((part) => ({
        drawId: part.drawId,
        items: part.items.map((item) => ({ ...item, stake: String(item.stake) })),
      })),
    },
  } as const;
}

/** หน้าสร้างบิล: สร้างและยืนยันบิลในขั้นตอนเดียว (หลายประเภทหวยได้ ผู้ใช้เห็นเป็นบิลเดียว) */
export async function placeBillAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireActor();
  const slip = readSlipParts(formData);
  if ("error" in slip) return { error: slip.error ?? "ข้อมูลไม่ถูกต้อง" };

  let billId: string;
  let duplicate = false;
  try {
    const placed = await placeSlip(actor, slip.data);
    // เปิดหน้าส่วนแรกของบิล หน้านั้นแสดงทุกประเภทหวยในบิลเดียวกัน
    billId = placed.bills[0]!.billId;
    duplicate = placed.duplicate === true;
  } catch (error) {
    if (error instanceof BillItemsRejectedError) return { error: error.message, rejected: error.rejected };
    if (error instanceof AppError) return { error: error.message };
    throw error;
  }

  revalidatePath("/bills");
  redirect(`/bills/${billId}?placed=1${duplicate ? "&dup=1" : ""}`);
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

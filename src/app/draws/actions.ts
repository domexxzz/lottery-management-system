"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import { createDraw, deleteDrawPermanently, lockDrawManually } from "@/lib/draws/service";
import { createLaoDraws } from "@/lib/lao/service";
import { AppError } from "@/lib/errors";

export type ActionState = { error: string | null; message: string | null };

const CreateSchema = z.object({
  drawDate: z.string().min(1, "กรุณาเลือกงวด"),
  opensAt: z.string().min(1, "กรุณาระบุเวลาเปิดรับ"),
  cutoffAt: z.string().min(1, "กรุณาระบุเวลาปิดรับ"),
});

export async function createDrawAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();

  const parsed = CreateSchema.safeParse({
    drawDate: formData.get("drawDate"),
    opensAt: formData.get("opensAt"),
    cutoffAt: formData.get("cutoffAt"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง", message: null };
  }

  try {
    const outcome = await createDraw(actor, parsed.data);
    revalidatePath("/draws");
    revalidatePath("/draws/all");
    return {
      error: null,
      message: outcome.duplicate ? "สร้างงวดซ้ำแล้ว ระบบเก็บเป็นคนละงวด" : "สร้างงวดแล้ว",
    };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, message: null };
    throw error;
  }

}

export async function lockDrawAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    const outcome = await lockDrawManually(actor, drawId);
    revalidatePath("/draws");
    revalidatePath("/draws/all");
    return {
      error: null,
      message: `ปิดงวด "${outcome.drawName}" แล้ว · ล็อกบิล ${outcome.billsLocked} ใบ · ยกเลิกร่างค้าง ${outcome.draftsCancelled} ใบ`,
    };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, message: null };
    throw error;
  }
}

export async function deleteDrawAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();
  const drawId = String(formData.get("drawId") ?? "");

  try {
    const outcome = await deleteDrawPermanently(actor, drawId);
    revalidatePath("/draws");
    revalidatePath("/draws/all");
    revalidatePath("/bills");
    revalidatePath("/reports");
    return {
      error: null,
      message: `ลบงวดว่าง “${outcome.drawName}” แล้ว`,
    };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, message: null };
    throw error;
  }
}

/** สร้างงวดหวยลาวและ/หรือหวยลาวชุดของวันที่เลือก */
export async function createLaoDrawAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const actor = await requireActor();
  const lotteryTypes = formData.getAll("lotteryType").map(String).filter((value): value is "LAO" | "LAO_SET" => value === "LAO" || value === "LAO_SET");
  try {
    const { drawIds, duplicates } = await createLaoDraws(actor, {
      drawDate: String(formData.get("drawDate") ?? ""),
      opensAt: String(formData.get("opensAt") ?? ""),
      cutoffAt: String(formData.get("cutoffAt") ?? ""),
      resultAt: String(formData.get("resultAt") ?? "") || undefined,
      lotteryTypes,
    });
    revalidatePath("/draws");
    revalidatePath("/draws/all");
    revalidatePath("/bills/new");
    return {
      error: null,
      message: duplicates.length > 0
        ? `สร้างงวดซ้ำแล้ว (${duplicates.join(" และ ")} ของวันนี้มีอยู่แล้ว ระบบเก็บเป็นคนละงวด)`
        : `สร้างงวดหวยลาวแล้ว ${drawIds.length} งวด`,
    };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, message: null };
    throw error;
  }
}

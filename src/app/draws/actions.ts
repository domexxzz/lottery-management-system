"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import { createDraw, lockDrawManually } from "@/lib/draws/service";
import { AppError } from "@/lib/errors";

export type ActionState = { error: string | null; message: string | null };

const CreateSchema = z.object({
  name: z.string().trim().min(1, "กรุณากรอกชื่อรอบ").max(120),
  opensAt: z.string().min(1, "กรุณาระบุเวลาเปิดรับ"),
  cutoffAt: z.string().min(1, "กรุณาระบุเวลาปิดรับ"),
});

export async function createDrawAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const actor = await requireActor();

  const parsed = CreateSchema.safeParse({
    name: formData.get("name"),
    opensAt: formData.get("opensAt"),
    cutoffAt: formData.get("cutoffAt"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง", message: null };
  }

  try {
    await createDraw(actor, parsed.data);
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, message: null };
    throw error;
  }

  revalidatePath("/draws");
  return { error: null, message: "สร้างรอบแล้ว" };
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
    return {
      error: null,
      message: `ปิดรอบ "${outcome.drawName}" แล้ว · ล็อกบิล ${outcome.billsLocked} ใบ · ยกเลิกร่างค้าง ${outcome.draftsCancelled} ใบ`,
    };
  } catch (error) {
    if (error instanceof AppError) return { error: error.message, message: null };
    throw error;
  }
}

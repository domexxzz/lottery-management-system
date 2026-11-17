import { z } from "zod";
import { requireActor } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { deleteAllEvidence } from "@/lib/evidence/retention";
import { apiError, assertSameOrigin } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ expectedTotal: z.number().int().min(0) });

/** Owner ลบหลักฐานทั้งหมด หลังยืนยันในหน้าต่างที่แสดงจำนวนรูปแยกตามงวด */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const body = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) throw new AppError("ข้อมูลยืนยันไม่ถูกต้อง", 422, "VALIDATION_FAILED");
    const result = await deleteAllEvidence(actor, body.data.expectedTotal);
    return Response.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

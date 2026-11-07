import { getActor, orgScope, requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { AppError, ConflictError, NotFoundError, UnauthorizedError } from "@/lib/errors";
import { bangkokDate, buildGloPrizeSuggestions, fetchGloDrawResult } from "@/lib/glo/results";
import { apiError, assertSameOrigin } from "@/lib/http";
import { z } from "zod";

export const dynamic = "force-dynamic";
const bodySchema = z.object({ drawDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "วันที่งวดไม่ถูกต้อง").optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await getActor();
    if (!actor) throw new UnauthorizedError();
    requirePermission(actor, "result.enter");

    const { id } = await context.params;
    const draw = await prisma.draw.findFirst({
      where: { id, ...orgScope(actor) },
      select: { id: true, name: true, cutoffAt: true, status: true },
    });
    if (!draw) throw new NotFoundError("ไม่พบรอบ");
    if (draw.status !== "LOCKED" && draw.status !== "RESULT_PENDING") {
      throw new ConflictError("ดึงผลได้เฉพาะรอบที่ปิดรับแล้วและยังไม่ปิดบัญชี");
    }

    const body = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) throw new AppError(body.error.issues[0]?.message ?? "วันที่งวดไม่ถูกต้อง", 422, "VALIDATION_FAILED");
    const requestedDate = body.data.drawDate ?? bangkokDate(draw.cutoffAt);
    const official = await fetchGloDrawResult(requestedDate);
    return Response.json({
      data: {
        drawId: draw.id,
        drawName: draw.name,
        requestedDate,
        official,
        suggestions: buildGloPrizeSuggestions(official),
        source: "สำนักงานสลากกินแบ่งรัฐบาล (GLO)",
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) return apiError(error);
    return apiError(error);
  }
}

import { requireActor } from "@/lib/auth/context";
import { reviewAttachment } from "@/lib/evidence/service";
import { apiError, assertSameOrigin } from "@/lib/http";
import { ValidationError } from "@/lib/errors";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as { reason?: unknown } | null;
    if (!body || typeof body.reason !== "string") throw new ValidationError("กรุณาระบุเหตุผลที่ตีกลับ");
    await reviewAttachment(actor, id, "REJECTED", body.reason);
    return Response.json({ data: { status: "REJECTED" } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

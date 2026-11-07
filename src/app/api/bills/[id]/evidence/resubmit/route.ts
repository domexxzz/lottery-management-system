import { requireActor } from "@/lib/auth/context";
import { resubmitEvidence } from "@/lib/evidence/service";
import { apiError, assertSameOrigin } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { id } = await context.params;
    await resubmitEvidence(actor, id);
    return Response.json({ data: { submitted: true } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

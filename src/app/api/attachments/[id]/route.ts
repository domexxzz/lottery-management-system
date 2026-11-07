import { requireActor } from "@/lib/auth/context";
import { deleteDraftAttachment } from "@/lib/evidence/service";
import { apiError, assertSameOrigin } from "@/lib/http";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { id } = await context.params;
    await deleteDraftAttachment(actor, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

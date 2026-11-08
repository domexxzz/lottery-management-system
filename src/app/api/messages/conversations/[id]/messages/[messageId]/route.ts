import { requireActor } from "@/lib/auth/context";
import { apiError, assertSameOrigin } from "@/lib/http";
import { cancelMessage, touchPresence } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    await touchPresence(actor);
    const { id, messageId } = await context.params;
    return Response.json({ data: await cancelMessage(actor, id, messageId) });
  } catch (error) {
    return apiError(error);
  }
}

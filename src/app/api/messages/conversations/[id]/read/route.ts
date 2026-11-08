import { requireActor } from "@/lib/auth/context";
import { apiError, assertSameOrigin } from "@/lib/http";
import { markRead } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { id } = await context.params;
    await markRead(actor, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

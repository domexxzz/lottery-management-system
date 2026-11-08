import { requireActor } from "@/lib/auth/context";
import { apiError } from "@/lib/http";
import { signedAvatarUrl } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  try {
    const actor = await requireActor();
    const { userId } = await context.params;
    return Response.redirect(await signedAvatarUrl(actor, userId), 302);
  } catch (error) {
    return apiError(error);
  }
}

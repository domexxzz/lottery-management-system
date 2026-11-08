import { requireActor } from "@/lib/auth/context";
import { apiError } from "@/lib/http";
import { listContacts, touchPresence } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    await touchPresence(actor);
    const query = new URL(request.url).searchParams.get("q") ?? undefined;
    return Response.json({ data: await listContacts(actor, query) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

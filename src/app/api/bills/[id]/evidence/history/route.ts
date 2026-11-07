import { requireActor } from "@/lib/auth/context";
import { evidenceHistory } from "@/lib/evidence/service";
import { apiError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return Response.json({ data: await evidenceHistory(actor, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

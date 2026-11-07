import { requireActor } from "@/lib/auth/context";
import { duplicateEvidenceHistory } from "@/lib/evidence/service";
import { apiError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const rows = await duplicateEvidenceHistory(actor, id);
    return Response.json({ data: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

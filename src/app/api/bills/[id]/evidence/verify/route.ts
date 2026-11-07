import { requireActor } from "@/lib/auth/context";
import { verifyBillEvidence } from "@/lib/evidence/service";
import { apiError, assertSameOrigin } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { id } = await context.params;
    const verifiedCount = await verifyBillEvidence(actor, id);
    return Response.json(
      { data: { status: "VERIFIED", verifiedCount } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

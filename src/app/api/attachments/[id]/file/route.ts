import { requireActor } from "@/lib/auth/context";
import { signedAttachmentUrl } from "@/lib/evidence/service";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const download = new URL(request.url).searchParams.get("download") === "1";
    const url = await signedAttachmentUrl(actor, id, download ? "attachment" : "inline");
    return new Response(null, {
      status: 307,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

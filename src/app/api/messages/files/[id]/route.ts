import { requireActor } from "@/lib/auth/context";
import { apiError } from "@/lib/http";
import { signedMessageFileUrl } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

/** พาไปยังลิงก์อายุสั้นของไฟล์แนบ ไม่เปิดเผย storageKey ให้ client */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    const download = new URL(request.url).searchParams.get("download") === "1";
    const url = await signedMessageFileUrl(actor, id, download ? "attachment" : "inline");
    return Response.redirect(url, 302);
  } catch (error) {
    return apiError(error);
  }
}

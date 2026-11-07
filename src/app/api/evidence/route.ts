import type { AttachmentStatus, AttachmentType } from "@prisma/client";
import { requireActor } from "@/lib/auth/context";
import { listEvidenceReviewQueue } from "@/lib/evidence/service";
import { apiError } from "@/lib/http";

const STATUSES = new Set<AttachmentStatus>(["PENDING", "VERIFIED", "REJECTED"]);
const TYPES = new Set<AttachmentType>(["ORDER_EVIDENCE", "PAYMENT_EVIDENCE", "OTHER"]);

export async function GET(request: Request) {
  try {
    const actor = await requireActor();
    const params = new URL(request.url).searchParams;
    const status = params.get("status") as AttachmentStatus | null;
    const type = params.get("type") as AttachmentType | null;
    const page = Math.max(1, Number(params.get("page")) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(params.get("pageSize")) || 25));
    const result = await listEvidenceReviewQueue(actor, {
      query: params.get("q")?.trim() || undefined,
      status: status && STATUSES.has(status) ? status : undefined,
      type: type && TYPES.has(type) ? type : undefined,
      page,
      pageSize,
    });
    return Response.json({ data: result.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

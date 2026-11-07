import type { AttachmentType } from "@prisma/client";
import { requireActor } from "@/lib/auth/context";
import { apiError, assertSameOrigin } from "@/lib/http";
import { listBillAttachments, uploadBillAttachment } from "@/lib/evidence/service";
import { ValidationError } from "@/lib/errors";
import { getStorageConfig } from "@/lib/storage/config";

export const runtime = "nodejs";

// รับเฉพาะหลักฐานการสั่งซื้อ · สลิปการชำระเงินเลิกรับแล้ว
const TYPES = new Set<AttachmentType>(["ORDER_EVIDENCE", "OTHER"]);

function optional(form: FormData, key: string): string | undefined {
  const value = String(form.get(key) ?? "").trim();
  return value || undefined;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    const { id } = await context.params;
    return Response.json({ data: await listBillAttachments(actor, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { id } = await context.params;
    const config = getStorageConfig();
    const contentLength = Number(request.headers.get("content-length"));
    // ปฏิเสธ payload ใหญ่ก่อน parse multipart เพื่อลดความเสี่ยง memory exhaustion
    // เผื่อพื้นที่ 1 MB สำหรับ multipart boundary และ metadata ของฟอร์ม
    if (Number.isFinite(contentLength) && contentLength > config.maxFileSizeBytes + 1024 * 1024) {
      throw new ValidationError(
        `คำขอมีขนาดใหญ่เกินกำหนด รูปต้องไม่เกิน ${Math.round(config.maxFileSizeBytes / 1024 / 1024)} MB`,
      );
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("กรุณาเลือกไฟล์รูป");
    if (file.size > config.maxFileSizeBytes) {
      throw new ValidationError(`รูปต้องมีขนาดไม่เกิน ${Math.round(config.maxFileSizeBytes / 1024 / 1024)} MB`);
    }
    const type = String(form.get("type") ?? "") as AttachmentType;
    if (!TYPES.has(type)) throw new ValidationError("ประเภทหลักฐานไม่ถูกต้อง");

    const result = await uploadBillAttachment(actor, id, {
      type,
      fileName: file.name,
      declaredMimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      idempotencyKey: String(form.get("idempotencyKey") ?? ""),
      replacesId: optional(form, "replacesId"),
    });
    return Response.json({ data: result }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

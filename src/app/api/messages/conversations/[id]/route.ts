import { requireActor } from "@/lib/auth/context";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getStorageConfig } from "@/lib/storage/config";
import { listMessages, sendMessage, touchPresence, type OutgoingFile } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireActor();
    await touchPresence(actor);
    const { id } = await context.params;
    return Response.json({ data: await listMessages(actor, id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * ส่งข้อความ รองรับทั้ง JSON ล้วนและ multipart ที่มีไฟล์แนบ
 *
 * แยกตาม content-type เพราะการส่งข้อความเปล่าเป็น JSON เบากว่ามาก
 * ไม่ต้องห่อเป็น multipart ทุกครั้งทั้งที่ส่วนใหญ่ไม่มีไฟล์
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const { id } = await context.params;
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.includes("multipart/form-data")) {
      const body = (await request.json()) as { body?: unknown };
      const text = typeof body.body === "string" ? body.body : "";
      return Response.json({ data: await sendMessage(actor, id, { body: text }) }, { status: 201 });
    }

    const config = getStorageConfig();
    const form = await request.formData();
    const text = String(form.get("body") ?? "");
    const files: OutgoingFile[] = [];
    for (const entry of form.getAll("files")) {
      if (!(entry instanceof File)) continue;
      if (entry.size > config.maxFileSizeBytes) {
        return Response.json(
          { error: { message: `ไฟล์ต้องมีขนาดไม่เกิน ${Math.round(config.maxFileSizeBytes / 1024 / 1024)} MB` } },
          { status: 400 },
        );
      }
      files.push({
        fileName: entry.name,
        declaredMimeType: entry.type,
        bytes: Buffer.from(await entry.arrayBuffer()),
      });
    }
    return Response.json({ data: await sendMessage(actor, id, { body: text, files }) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

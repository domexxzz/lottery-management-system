import { requireActor } from "@/lib/auth/context";
import { apiError, assertSameOrigin } from "@/lib/http";
import { getStorageConfig } from "@/lib/storage/config";
import { setOwnAvatar } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

/** ตั้งรูปโปรไฟล์ของตัวเองเท่านั้น ไม่มีเส้นทางให้เปลี่ยนของคนอื่น */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const config = getStorageConfig();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return Response.json({ error: { message: "กรุณาเลือกไฟล์รูป" } }, { status: 400 });
    }
    if (file.size > config.maxFileSizeBytes) {
      return Response.json(
        { error: { message: `รูปต้องมีขนาดไม่เกิน ${Math.round(config.maxFileSizeBytes / 1024 / 1024)} MB` } },
        { status: 400 },
      );
    }
    await setOwnAvatar(actor, {
      fileName: file.name,
      declaredMimeType: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}

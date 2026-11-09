import { revalidatePath } from "next/cache";
import { requireActor } from "@/lib/auth/context";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { apiError, assertSameOrigin } from "@/lib/http";
import { isMockDataEnabled, setMockDataEnabled } from "@/lib/mock-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    // หน้าจอทุกหน้า poll ตัวนี้เพื่อรู้แค่สถานะเปิด/ปิด จึงไม่ต้องนับบิลจำลองทุกครั้ง
    return Response.json({ enabled: await isMockDataEnabled(actor.organizationId) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    if (actor.role !== "GODMODE" && actor.role !== "OWNER") throw new ForbiddenError("เฉพาะ Godmode หรือ Owner เท่านั้นที่เปิดหรือปิดข้อมูลจำลองได้");
    const body = await request.json() as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") throw new ValidationError("สถานะข้อมูลจำลองไม่ถูกต้อง");
    const result = await setMockDataEnabled(actor, body.enabled);
    revalidatePath("/", "layout");
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

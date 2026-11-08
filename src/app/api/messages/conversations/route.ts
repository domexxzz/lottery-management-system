import { requireActor } from "@/lib/auth/context";
import { apiError, assertSameOrigin } from "@/lib/http";
import { listConversations, openConversation, touchPresence } from "@/lib/messages/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await requireActor();
    await touchPresence(actor);
    return Response.json({ data: await listConversations(actor) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

/** เปิดห้องกับผู้ใช้คนหนึ่ง ถ้ามีอยู่แล้วคืนห้องเดิม */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireActor();
    const body = (await request.json()) as { userId?: unknown };
    if (typeof body.userId !== "string") {
      return Response.json({ error: { message: "ต้องระบุผู้ใช้ที่จะคุยด้วย" } }, { status: 400 });
    }
    return Response.json({ data: await openConversation(actor, body.userId) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

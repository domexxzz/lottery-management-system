import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { getOwnerConversation } from "@/lib/chat/history";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  if (actor.role !== "GODMODE" && actor.role !== "OWNER") {
    return NextResponse.json({ error: "เฉพาะ Godmode หรือ Owner เท่านั้นที่ดูประวัติการสนทนาได้" }, { status: 403 });
  }

  const { id } = await context.params;
  const conversation = await getOwnerConversation(actor, id);
  if (!conversation) return NextResponse.json({ error: "ไม่พบบทสนทนานี้" }, { status: 404 });
  return NextResponse.json({ conversation });
}

import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { listOwnerConversations } from "@/lib/chat/history";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  if (actor.role !== "GODMODE" && actor.role !== "OWNER") {
    return NextResponse.json({ error: "เฉพาะ Godmode หรือ Owner เท่านั้นที่ดูประวัติการสนทนาได้" }, { status: 403 });
  }
  return NextResponse.json({ conversations: await listOwnerConversations(actor) });
}

import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { ownerChatRequestSchema } from "@/lib/chat/schema";
import { getOwnerConversationContext, saveOwnerChatExchange } from "@/lib/chat/history";
import { checkQuota, recordAssistantQuery } from "@/lib/chat/usage";
import { askOwnerAssistant } from "@/lib/chat/typhoon";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * แปลง error เป็นรหัสสั้น ๆ สำหรับ Audit — ไม่เก็บข้อความจากผู้ให้บริการ
 *
 * รูปแบบที่ askOwnerAssistant โยนออกมาคือ TYPHOON_REQUEST_FAILED:<status>:<ข้อความ>
 * เก็บแค่สองส่วนแรก เพราะส่วนที่สามเป็นข้อความอิสระจากภายนอก
 */
function failureCode(error: unknown): string {
  if (!(error instanceof Error)) return "UNKNOWN";
  if (error.name === "AbortError") return "TIMEOUT";
  const [code, status] = error.message.split(":");
  if ((code === "TYPHOON_REQUEST_FAILED" || code === "TYPHOON_AUTH_FAILED") && status) {
    return `${code}:${status}`;
  }
  return code ?? "UNKNOWN";
}

/**
 * ข้อความที่ผู้ใช้เห็นเมื่อผู้ให้บริการตอบไม่สำเร็จ
 *
 * ตอนตั้งค่าครั้งแรก ความต่างระหว่าง "key ผิด" กับ "ชื่อโมเดลผิด" สำคัญมาก
 * ถ้าบอกว่า "ติดต่อไม่ได้" เหมือนกันหมด ผู้ใช้จะไล่หาสาเหตุไม่เจอ
 * ข้อความเหล่านี้บอกชื่อตัวแปรที่ต้องแก้ ไม่ได้เปิดเผยค่าของมัน
 */
function upstreamMessage(failure: string): string {
  const [code, rawStatus] = failure.split(":");
  const status = Number(rawStatus);
  if (code === "TYPHOON_AUTH_FAILED") {
    return "Typhoon ปฏิเสธคีย์ที่ตั้งไว้ กรุณาตรวจสอบ TYPHOON_API_KEY ว่าถูกต้องและยังไม่ถูกเพิกถอน";
  }
  if (status === 404 || status === 400) {
    return "Typhoon ไม่รับคำขอนี้ กรุณาตรวจสอบค่า TYPHOON_MODEL และ TYPHOON_BASE_URL";
  }
  if (status === 429) {
    return "ตอนนี้มีคำถามเข้ามาพร้อมกันมาก กรุณารอสักครู่แล้วลองใหม่ครับ";
  }
  return "ตอนนี้ผมติดต่อระบบวิเคราะห์ไม่ได้ กรุณาลองใหม่อีกครั้งครับ";
}

export async function POST(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  if (actor.role !== "GODMODE" && actor.role !== "OWNER") {
    return NextResponse.json({ error: "เฉพาะ Godmode หรือ Owner เท่านั้นที่ใช้ผู้ช่วย AI ได้" }, { status: 403 });
  }

  const parsed = ownerChatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง" },
      { status: 422 },
    );
  }

  const previousMessages = parsed.data.conversationId
    ? await getOwnerConversationContext(actor, parsed.data.conversationId)
    : [];
  if (previousMessages === null) {
    return NextResponse.json({ error: "ไม่พบบทสนทนานี้" }, { status: 404 });
  }
  const messages = [
    ...previousMessages,
    { role: "user" as const, content: parsed.data.message },
  ];

  // คุมทั้งค่าใช้จ่ายปลายทางและโหลดฐานข้อมูล — ตรวจก่อนทำงานหนัก
  const quota = await checkQuota(actor);
  if (!quota.allowed) {
    return NextResponse.json(
      {
        error: `ใช้ผู้ช่วยครบ ${quota.limit} คำถามในหนึ่งชั่วโมงแล้ว กรุณารอสักครู่แล้วลองใหม่`,
      },
      { status: 429 },
    );
  }

  const startedAt = Date.now();
  const messageCount = messages.length;

  try {
    const reply = await askOwnerAssistant(actor, messages);
    const conversation = await saveOwnerChatExchange(actor, {
      conversationId: parsed.data.conversationId,
      userContent: parsed.data.message,
      assistantContent: reply,
    });
    if (!conversation) {
      return NextResponse.json({ error: "ไม่พบบทสนทนานี้" }, { status: 404 });
    }
    await recordAssistantQuery(actor, {
      messageCount,
      ok: true,
      latencyMs: Date.now() - startedAt,
    });
    return NextResponse.json({
      reply,
      conversation,
      quota: { used: quota.used + 1, limit: quota.limit },
    });
  } catch (error) {
    const failure = failureCode(error);
    await recordAssistantQuery(actor, {
      messageCount,
      ok: false,
      latencyMs: Date.now() - startedAt,
      failure,
    });
    logger.warn("owner assistant failed", { requestId: actor.requestId, failure });

    if (failure === "TYPHOON_NOT_CONFIGURED") {
      return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าผู้ช่วยสำหรับระบบนี้ กรุณาติดต่อผู้ดูแล" }, { status: 503 });
    }
    if (failure === "TIMEOUT") {
      return NextResponse.json({ error: "ผมใช้เวลาคิดนานเกินไป กรุณาลองถามใหม่อีกครั้งครับ" }, { status: 504 });
    }
    // ติดต่อได้แต่แกะข้อความไม่ได้ — คนละเรื่องกับติดต่อไม่ได้ จึงไม่ควรบอกเหมือนกัน
    if (failure === "TYPHOON_EMPTY_RESPONSE") {
      return NextResponse.json(
        { error: "ผมตอบกลับมาไม่สมบูรณ์ กรุณาลองถามใหม่อีกครั้งครับ" },
        { status: 502 },
      );
    }
    return NextResponse.json({ error: upstreamMessage(failure) }, { status: 502 });
  }
}

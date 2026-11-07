import { logger } from "@/lib/logger";
import { channelThreadId } from "./channels";
import {
  answerCallbackQuery,
  fetchTelegramUpdates,
  sendTelegramMessage,
  type TelegramUpdate,
} from "./telegram";
import { handleEvidenceAction, parseCallbackData } from "./telegram-actions";

/**
 * รับเหตุการณ์จาก Telegram แล้วลงมือทำ
 *
 * ใช้ long polling ไม่ใช้ webhook เพราะ webhook ต้องมี URL สาธารณะแบบ HTTPS
 * ซึ่งเครื่องพัฒนาไม่มี และระบบหลังบ้านที่อยู่หลังไฟร์วอลล์ก็มักไม่มีเหมือนกัน
 * polling ทำงานได้ทุกที่ที่ต่อเน็ตออกได้ แลกกับความหน่วงเท่ากับรอบที่เฝ้าดู
 *
 * การกดปุ่มซ้ำหรือประมวลผลซ้ำไม่เป็นอันตราย เพราะ reviewAttachment
 * ปฏิเสธหลักฐานที่ตรวจไปแล้วอยู่แล้ว ความถูกต้องจึงไม่ได้พึ่งการจำว่าเคยอ่านอะไรไปแล้ว
 */

/**
 * เครื่องหมายที่ฝังในข้อความขอเหตุผล
 *
 * ปุ่มใน Telegram พกข้อความอิสระไม่ได้ การตีกลับจึงต้องถามเหตุผลเป็นอีกจังหวะ
 * ตัวระบุหลักฐานถูกฝังไว้ในข้อความที่บอทส่ง แล้วอ่านกลับจากข้อความที่ผู้ใช้ตอบกลับมา
 * วิธีนี้ไม่ต้องเก็บสถานะการสนทนาไว้ที่ไหนเลย ซึ่งแปลว่ารีสตาร์ตแล้วยังใช้งานต่อได้
 */
const REASON_MARKER = /\[ev:r:([a-z0-9]+)\]/i;

function buildReasonPrompt(attachmentId: string): string {
  return [
    "ตีกลับหลักฐาน — กรุณาตอบกลับข้อความนี้พร้อมเหตุผล",
    "",
    `[ev:r:${attachmentId}]`,
  ].join("\n");
}

export type InboxOutcome = {
  processed: number;
  verified: number;
  rejected: number;
  ignored: number;
};

/**
 * ตัวชี้ว่าอ่านถึงไหนแล้ว
 *
 * อยู่ในหน่วยความจำเท่านั้น และนั่นเพียงพอ เพราะตัวชี้ตัวจริงอยู่ที่ Telegram
 * การเรียก getUpdates ด้วย offset ทำให้ Telegram ทิ้งเหตุการณ์ก่อนหน้านั้นถาวร
 * รอบถัดไปจึงไม่ได้ของเดิมกลับมาอีก ไม่ว่าจะเป็น process เดิมหรือ process ใหม่
 */
let nextOffset: number | undefined;

async function handleCallback(update: TelegramUpdate): Promise<"verified" | "rejected" | "ignored"> {
  const query = update.callback_query;
  if (!query?.id) return "ignored";

  const action = query.data ? parseCallbackData(query.data) : null;
  if (!action) return "ignored";

  const telegramUserId = query.from?.id ? String(query.from.id) : "";
  if (!telegramUserId) {
    await answerCallbackQuery({ callbackQueryId: query.id, text: "ระบุผู้กดไม่ได้", showAlert: true });
    return "ignored";
  }

  if (action.kind === "verify") {
    const outcome = await handleEvidenceAction({ telegramUserId, action });
    await answerCallbackQuery({
      callbackQueryId: query.id,
      text: outcome.message,
      showAlert: !outcome.ok,
    });
    return outcome.ok ? "verified" : "ignored";
  }

  /*
   * การตีกลับต้องมีเหตุผลตามกฎของ service
   *
   * ตรวจสิทธิ์ก่อนถามเหตุผล เพื่อไม่ให้คนที่กดไม่ได้อยู่แล้วเสียเวลาพิมพ์
   * แล้วเพิ่งมารู้ตอนท้ายว่าทำไม่ได้
   */
  const probe = await handleEvidenceAction({ telegramUserId, action, reason: undefined });
  if (probe.message.includes("ยังไม่ได้ผูก")) {
    await answerCallbackQuery({ callbackQueryId: query.id, text: probe.message, showAlert: true });
    return "ignored";
  }

  await answerCallbackQuery({
    callbackQueryId: query.id,
    text: "ตอบกลับข้อความที่บอทส่ง พร้อมเหตุผลที่ตีกลับ",
  });
  await sendTelegramMessage(buildReasonPrompt(query.data!), {
    threadId: channelThreadId("evidence"),
    forceReply: true,
  });
  return "ignored";
}

async function handleReply(update: TelegramUpdate): Promise<"rejected" | "ignored"> {
  const message = update.message;
  const repliedTo = message?.reply_to_message?.text;
  if (!message?.text || !repliedTo) return "ignored";

  const marker = REASON_MARKER.exec(repliedTo);
  if (!marker?.[1]) return "ignored";

  const action = parseCallbackData(marker[1]);
  if (!action) return "ignored";

  const telegramUserId = message.from?.id ? String(message.from.id) : "";
  if (!telegramUserId) return "ignored";

  const outcome = await handleEvidenceAction({
    telegramUserId,
    action,
    reason: message.text,
  });

  await sendTelegramMessage(outcome.message, { threadId: channelThreadId("evidence") });
  return outcome.ok ? "rejected" : "ignored";
}

/** อ่านเหตุการณ์ที่ค้างอยู่แล้วลงมือทำ เรียกซ้ำได้ปลอดภัย */
export async function processTelegramInbox(
  options: { longPollSeconds?: number } = {},
): Promise<InboxOutcome> {
  const updates = await fetchTelegramUpdates(nextOffset, options);
  const outcome: InboxOutcome = { processed: 0, verified: 0, rejected: 0, ignored: 0 };

  for (const update of updates) {
    // เลื่อนตัวชี้ก่อนลงมือ เพื่อไม่ให้เหตุการณ์ที่ทำให้ล้มวนซ้ำไม่รู้จบ
    nextOffset = update.update_id + 1;
    outcome.processed += 1;

    try {
      const result = update.callback_query
        ? await handleCallback(update)
        : await handleReply(update);

      if (result === "verified") outcome.verified += 1;
      else if (result === "rejected") outcome.rejected += 1;
      else outcome.ignored += 1;
    } catch (error) {
      outcome.ignored += 1;
      logger.error("telegram inbox update failed", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /*
   * ยืนยันกับ Telegram ว่าอ่านถึงไหนแล้ว
   *
   * ถ้าไม่ทำ เหตุการณ์ที่เพิ่งประมวลผลจะยังค้างอยู่ฝั่ง Telegram
   * โหมดเฝ้าดูไม่เห็นปัญหาเพราะรอบถัดไปในกระบวนการเดิมยืนยันให้เอง
   * แต่โหมดรันครั้งเดียว ซึ่ง Task Scheduler ใช้ จะจบไปก่อนยืนยัน
   * ทำให้รอบหน้าได้ของเดิมกลับมา แล้วถามเหตุผลตีกลับซ้ำไม่รู้จบ
   */
  if (outcome.processed > 0 && nextOffset !== undefined) {
    await fetchTelegramUpdates(nextOffset);
  }

  return outcome;
}

/** ใช้ในเทสเพื่อให้แต่ละเคสเริ่มจากศูนย์ */
export function resetInboxOffsetForTests(): void {
  nextOffset = undefined;
}

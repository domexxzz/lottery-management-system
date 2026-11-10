/**
 * ตัวส่งข้อความ Telegram
 *
 * หลักการสามข้อ
 *
 * 1. ล้มได้โดยไม่ลากอย่างอื่นล้มตาม
 *    การแจ้งเตือนเป็นงานเสริม ถ้า Telegram ล่มหรือช้า เส้นทางเงินต้องไม่สะดุด
 *    ฟังก์ชันที่นี่จึงคืนผลลัพธ์เป็นค่า ไม่โยน error ให้ผู้เรียกต้องดักเอง
 *
 * 2. ไม่เก็บโทเค็นไว้ในที่อื่นนอกจาก environment
 *    และไม่พ่นโทเค็นลง log ไม่ว่ากรณีใด แม้ตอน error
 *
 * 3. ข้อความถูกประกอบไว้แล้วก่อนถึงที่นี่
 *    โมดูลนี้ไม่รู้จักบิล ไม่รู้จักรอบ รู้แค่วิธีส่งข้อความออกไป
 *    การตัดสินว่าอะไรส่งได้บ้างอยู่ที่ผู้เรียก ไม่ใช่ที่ตัวส่ง
 */

const DEFAULT_BASE_URL = "https://api.telegram.org";
const DEFAULT_TIMEOUT_MS = 15_000;

/** Telegram จำกัดความยาวข้อความไว้ที่ 4096 ตัวอักษร */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
/** คำบรรยายใต้รูปจำกัดสั้นกว่าข้อความธรรมดามาก */
export const TELEGRAM_MAX_CAPTION_LENGTH = 1024;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN?.trim() && process.env.TELEGRAM_CHAT_ID?.trim());
}

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; reason: "NOT_CONFIGURED" | "TIMEOUT" | "AUTH_FAILED" | "REQUEST_FAILED"; detail: string };

type TelegramApiResponse = {
  ok?: boolean;
  description?: string;
  error_code?: number;
};

/**
 * ตัดข้อความยาวเกินให้พอดีขีดจำกัด
 *
 * ตัดดีกว่าให้ Telegram ปฏิเสธทั้งข้อความ เพราะผู้รับควรได้เห็นส่วนต้น
 * ซึ่งเป็นส่วนที่สำคัญที่สุดเสมอ และมีหางบอกว่าถูกตัด
 */
export function clampMessage(text: string): string {
  if (text.length <= TELEGRAM_MAX_MESSAGE_LENGTH) return text;
  const suffix = "\n… (ข้อความถูกตัดเพราะยาวเกินกำหนด)";
  return `${text.slice(0, TELEGRAM_MAX_MESSAGE_LENGTH - suffix.length)}${suffix}`;
}

/**
 * ซ่อนโทเค็นที่อาจติดมาในข้อความ error ของผู้ให้บริการ
 *
 * Telegram ใส่โทเค็นไว้ใน URL ข้อความ error จึงมีโอกาสมีโทเค็นติดมาด้วย
 * ถ้าปล่อยลง log เท่ากับเขียนความลับลงไฟล์
 */
export function redactToken(text: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const withoutToken = token ? text.split(token).join("<redacted>") : text;
  return withoutToken.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>");
}

export type InlineButton = { text: string; callbackData: string };

/**
 * แปลงปุ่มเป็นรูปแบบของ Telegram
 *
 * รับได้ทั้งแถวเดียวและหลายแถว เพราะข้อความคุมของบิลที่มีหลายไฟล์
 * ต้องมีปุ่มของแต่ละไฟล์คนละแถว ไม่งั้นอ่านไม่ออกว่าปุ่มไหนของอะไร
 */
function toInlineKeyboard(buttons: InlineButton[] | InlineButton[][]): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  const rows = Array.isArray(buttons[0]) ? (buttons as InlineButton[][]) : [buttons as InlineButton[]];
  return {
    inline_keyboard: rows.map((row) =>
      row.map((button) => ({ text: button.text, callback_data: button.callbackData })),
    ),
  };
}

export type SendOptions = {
  /** ปุ่มกดใต้ข้อความ ส่งเป็นแถวเดียวหรือหลายแถวก็ได้ */
  buttons?: InlineButton[] | InlineButton[][] | undefined;
  /** บังคับให้ผู้ใช้ตอบกลับข้อความนี้ ใช้ตอนขอเหตุผลที่ตีกลับ */
  forceReply?: boolean | undefined;
  /**
   * ห้องย่อยในกลุ่ม (Telegram Topic)
   *
   * ไม่ระบุ = ส่งเข้าห้อง General ของกลุ่ม
   * ระบุแล้วแต่ห้องถูกลบ Telegram จะปฏิเสธทั้งข้อความ ไม่ตกไปห้องรวมให้
   */
  threadId?: string | undefined;
};

export async function sendTelegramMessage(
  text: string,
  options: SendOptions = {},
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      detail: "ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID",
    };
  }

  const baseUrl = (process.env.TELEGRAM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInteger(process.env.TELEGRAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  );

  try {
    const response = await fetch(`${baseUrl}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: clampMessage(text),
        // ส่งเป็นข้อความธรรมดา ไม่ใช้ Markdown เพราะชื่อรอบและรหัสลูกค้า
        // เป็นข้อความอิสระ อาจมีอักขระที่ทำให้ Telegram ปฏิเสธทั้งข้อความ
        disable_web_page_preview: true,
        ...(options.threadId ? { message_thread_id: Number(options.threadId) } : {}),
        ...(options.forceReply ? { reply_markup: { force_reply: true, selective: true } } : {}),
        ...(options.buttons?.length ? { reply_markup: toInlineKeyboard(options.buttons) } : {}),
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as TelegramApiResponse;

    if (!response.ok || payload.ok !== true) {
      const detail = redactToken(payload.description ?? `HTTP ${response.status}`);
      /*
       * แยกปัญหาโทเค็นออกจากปัญหา chat id ด้วยสถานะเป็นหลัก
       *
       *   401 Unauthorized            โทเค็นผิด
       *   404 Not Found               เส้นทาง /bot<token>/ ไม่มีอยู่ คือโทเค็นผิด
       *   400 Bad Request: chat not found   chat id ผิด ไม่ใช่โทเค็น
       *
       * ห้ามใช้คำว่า "not found" ในข้อความเป็นสัญญาณของปัญหาโทเค็น
       * เพราะ chat id ผิดก็มีคำนี้เหมือนกัน แล้วจะพาผู้ใช้ไปแก้ผิดจุด
       */
      const authFailed =
        response.status === 401 || response.status === 404 || /unauthorized/i.test(detail);
      return {
        ok: false,
        reason: authFailed ? "AUTH_FAILED" : "REQUEST_FAILED",
        detail,
      };
    }

    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "TIMEOUT", detail: "Telegram ตอบไม่ทันเวลาที่กำหนด" };
    }
    return {
      ok: false,
      reason: "REQUEST_FAILED",
      detail: redactToken(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export type TelegramChatInfo = {
  id: number | string;
  /** private, group, supergroup หรือ channel */
  type: string;
  /** ชื่อกลุ่ม หรือชื่อผู้ใช้สำหรับแชทส่วนตัว */
  title: string;
};

/**
 * ถามว่าปลายทางที่ตั้งไว้คือแชทไหน
 *
 * มีไว้ให้ยืนยันก่อนส่งของจริงว่าไม่ได้ตั้ง chat id ผิดที่
 * เช่นตั้งเป็นแชทส่วนตัวทั้งที่ตั้งใจจะส่งเข้ากลุ่ม ซึ่งมองจากตัวเลขอย่างเดียวไม่รู้
 */
export async function getTelegramChatInfo(): Promise<
  { ok: true; chat: TelegramChatInfo } | { ok: false; reason: string; detail: string }
> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!token || !chatId) {
    return { ok: false, reason: "NOT_CONFIGURED", detail: "ยังไม่ได้ตั้งค่า" };
  }

  const baseUrl = (process.env.TELEGRAM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInteger(process.env.TELEGRAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  );

  try {
    const response = await fetch(`${baseUrl}/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as TelegramApiResponse & {
      result?: { id?: number; type?: string; title?: string; first_name?: string; username?: string };
    };

    if (!response.ok || payload.ok !== true || !payload.result) {
      return {
        ok: false,
        reason: response.status === 401 || response.status === 404 ? "AUTH_FAILED" : "REQUEST_FAILED",
        detail: redactToken(payload.description ?? `HTTP ${response.status}`),
      };
    }

    const result = payload.result;
    return {
      ok: true,
      chat: {
        id: result.id ?? chatId,
        type: result.type ?? "unknown",
        title: result.title ?? result.first_name ?? result.username ?? "(ไม่มีชื่อ)",
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "TIMEOUT", detail: "Telegram ตอบไม่ทันเวลาที่กำหนด" };
    }
    return {
      ok: false,
      reason: "REQUEST_FAILED",
      detail: redactToken(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timeout);
  }
}


/**
 * ส่งรูปพร้อมคำบรรยายและปุ่มกด
 *
 * อัปโหลดเป็น multipart ไม่ใช่ส่ง URL ให้ Telegram ไปดึงเอง ด้วยสองเหตุผล
 *   1. ไฟล์อยู่ใน private storage ซึ่งเครื่องของ Telegram เข้าไม่ถึงตอนพัฒนา
 *   2. signed URL ที่ส่งออกไปใครถือก็เปิดได้ตลอดอายุของมัน
 */
export async function sendTelegramPhoto(input: {
  photo: Buffer;
  fileName: string;
  caption: string;
  buttons?: InlineButton[] | InlineButton[][];
  threadId?: string | undefined;
}): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      detail: "ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID",
    };
  }

  const baseUrl = (process.env.TELEGRAM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInteger(process.env.TELEGRAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  );

  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    // คำบรรยายของรูปจำกัดสั้นกว่าข้อความธรรมดามาก
    form.append("caption", input.caption.slice(0, TELEGRAM_MAX_CAPTION_LENGTH));
    if (input.threadId) form.append("message_thread_id", input.threadId);
    if (input.buttons?.length) {
      form.append("reply_markup", JSON.stringify(toInlineKeyboard(input.buttons)));
    }
    form.append(
      "photo",
      new Blob([new Uint8Array(input.photo)], { type: "image/jpeg" }),
      input.fileName,
    );

    const response = await fetch(`${baseUrl}/bot${token}/sendPhoto`, {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as TelegramApiResponse;
    if (!response.ok || payload.ok !== true) {
      const detail = redactToken(payload.description ?? `HTTP ${response.status}`);
      const authFailed =
        response.status === 401 || response.status === 404 || /unauthorized/i.test(detail);
      return { ok: false, reason: authFailed ? "AUTH_FAILED" : "REQUEST_FAILED", detail };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "TIMEOUT", detail: "Telegram ตอบไม่ทันเวลาที่กำหนด" };
    }
    return {
      ok: false,
      reason: "REQUEST_FAILED",
      detail: redactToken(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * ตอบกลับการกดปุ่ม
 *
 * Telegram แสดงวงหมุนบนปุ่มจนกว่าจะได้รับคำตอบนี้ ถ้าไม่ตอบ ผู้กดจะค้างอยู่อย่างนั้น
 * จึงต้องตอบทุกครั้งไม่ว่าผลจะสำเร็จหรือไม่
 */
export async function answerCallbackQuery(input: {
  callbackQueryId: string;
  text: string;
  showAlert?: boolean;
}): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return;

  const baseUrl = (process.env.TELEGRAM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  try {
    await fetch(`${baseUrl}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: input.callbackQueryId,
        // Telegram ตัดข้อความนี้ที่ราว 200 ตัวอักษร
        text: input.text.slice(0, 200),
        show_alert: input.showAlert ?? false,
      }),
      cache: "no-store",
    });
  } catch {
    // ตอบกลับไม่สำเร็จไม่ใช่เรื่องคอขาดบาดตาย งานหลักทำไปแล้ว
  }
}

export type TelegramUser = { id?: number; first_name?: string; last_name?: string; username?: string };

export type TelegramUpdate = {
  update_id: number;
  callback_query?: {
    id: string;
    from?: TelegramUser;
    data?: string;
    /** ข้อความที่มีปุ่ม — บอกได้ว่ากดจากแชทไหน Telegram เป็นคนใส่ ปลอมไม่ได้ */
    message?: { chat?: { id?: number } };
  };
  message?: {
    text?: string;
    from?: TelegramUser;
    chat?: { id?: number };
    reply_to_message?: { text?: string };
  };
};

/** ชื่อที่ใช้แสดงและบันทึกว่าใครกด เช่น "สมชาย ใจดี (@somchai)" */
export function telegramDisplayName(user: TelegramUser | undefined): string {
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  const handle = user?.username ? `@${user.username}` : "";
  if (name && handle) return `${name} (${handle})`;
  return name || handle || (user?.id ? `Telegram ${user.id}` : "ไม่ทราบชื่อ");
}

/** แชทนี้คือกลุ่มที่ตั้งไว้ใน TELEGRAM_CHAT_ID หรือไม่ */
export function isConfiguredChat(chatId: number | undefined): boolean {
  const configured = process.env.TELEGRAM_CHAT_ID?.trim();
  return chatId !== undefined && Boolean(configured) && String(chatId) === configured;
}

/**
 * ดึงเหตุการณ์ใหม่จาก Telegram
 *
 * longPollSeconds > 0 ทำให้ Telegram ค้างสายไว้จนกว่าจะมีของหรือครบเวลา
 * ซึ่งทำให้การกดปุ่มถูกรับภายในเสี้ยววินาทีโดยไม่ต้องยิงถี่ ๆ ให้เปลือง
 * ใส่ 0 เมื่อต้องการเช็กแล้วจบทันที เช่นโหมดรันครั้งเดียว
 */
export async function fetchTelegramUpdates(
  offset?: number,
  options: { longPollSeconds?: number } = {},
): Promise<TelegramUpdate[]> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return [];

  const baseUrl = (process.env.TELEGRAM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const longPoll = Math.max(0, Math.floor(options.longPollSeconds ?? 0));
  const params = new URLSearchParams({
    timeout: String(longPoll),
    allowed_updates: JSON.stringify(["callback_query", "message"]),
  });
  if (offset !== undefined) params.set("offset", String(offset));

  const controller = new AbortController();
  // ต้องรอนานกว่าที่ขอให้ Telegram ค้างสาย ไม่งั้นเราตัดสายเองทุกครั้งที่ไม่มีของ
  const abortAfter =
    longPoll > 0
      ? (longPoll + 10) * 1000
      : positiveInteger(process.env.TELEGRAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), abortAfter);

  try {
    const response = await fetch(`${baseUrl}/bot${token}/getUpdates?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as TelegramApiResponse & {
      result?: TelegramUpdate[];
    };
    if (!response.ok || payload.ok !== true) return [];
    return payload.result ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/** Telegram รับอัลบั้มได้ครั้งละ 2 ถึง 10 รูป */
export const TELEGRAM_MEDIA_GROUP_MAX = 10;

/**
 * ส่งหลายรูปเป็นอัลบั้มเดียว
 *
 * ใช้เมื่อหลักฐานหลายใบเป็นของบิลเดียวกัน คนตรวจจะได้เห็นพร้อมกันในที่เดียว
 * ไม่ต้องไล่เลื่อนหาว่าใบไหนคู่กับใบไหน
 *
 * ข้อจำกัดของ Telegram: อัลบั้มแนบปุ่มไม่ได้
 * ผู้เรียกจึงต้องส่งข้อความคุมที่มีปุ่มตามไปอีกหนึ่งข้อความ
 */
export async function sendTelegramMediaGroup(input: {
  photos: { buffer: Buffer; fileName: string }[];
  caption: string;
  threadId?: string | undefined;
}): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

  if (!token || !chatId) {
    return {
      ok: false,
      reason: "NOT_CONFIGURED",
      detail: "ยังไม่ได้ตั้งค่า TELEGRAM_BOT_TOKEN หรือ TELEGRAM_CHAT_ID",
    };
  }

  const photos = input.photos.slice(0, TELEGRAM_MEDIA_GROUP_MAX);
  const baseUrl = (process.env.TELEGRAM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    positiveInteger(process.env.TELEGRAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
  );

  try {
    const form = new FormData();
    form.append("chat_id", chatId);
    if (input.threadId) form.append("message_thread_id", input.threadId);

    // คำบรรยายติดที่รูปแรกเท่านั้น Telegram จะแสดงเป็นคำบรรยายของทั้งอัลบั้ม
    const media = photos.map((photo, index) => ({
      type: "photo" as const,
      media: `attach://file${index}`,
      ...(index === 0 ? { caption: input.caption.slice(0, TELEGRAM_MAX_CAPTION_LENGTH) } : {}),
    }));
    form.append("media", JSON.stringify(media));

    photos.forEach((photo, index) => {
      form.append(
        `file${index}`,
        new Blob([new Uint8Array(photo.buffer)], { type: "image/jpeg" }),
        photo.fileName,
      );
    });

    const response = await fetch(`${baseUrl}/bot${token}/sendMediaGroup`, {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => ({}))) as TelegramApiResponse;
    if (!response.ok || payload.ok !== true) {
      const detail = redactToken(payload.description ?? `HTTP ${response.status}`);
      const authFailed =
        response.status === 401 || response.status === 404 || /unauthorized/i.test(detail);
      return { ok: false, reason: authFailed ? "AUTH_FAILED" : "REQUEST_FAILED", detail };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "TIMEOUT", detail: "Telegram ตอบไม่ทันเวลาที่กำหนด" };
    }
    return {
      ok: false,
      reason: "REQUEST_FAILED",
      detail: redactToken(error instanceof Error ? error.message : String(error)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

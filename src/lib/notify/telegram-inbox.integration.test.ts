import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { processTelegramInbox, resetInboxOffsetForTests } from "./telegram-inbox";

/**
 * การอ่านเหตุการณ์จาก Telegram
 *
 * อยู่ในชุด integration เพราะไฟล์นี้ดึง service ที่ import Prisma client เข้ามาด้วย
 * ซึ่งต้องมี DATABASE_URL จึงจะโหลดได้ แม้ตัวเทสเองจะไม่แตะฐานข้อมูลเลย
 *
 * จุดที่เคยพลาด: โหมดรันครั้งเดียวไม่ได้ยืนยันกับ Telegram ว่าอ่านถึงไหนแล้ว
 * ทำให้รอบหน้าได้เหตุการณ์เดิมกลับมา แล้วถามเหตุผลตีกลับซ้ำไม่รู้จบ
 * ซึ่งเป็นเรื่องใหญ่เมื่อให้ Task Scheduler เรียกงานทุกนาที
 */

const original = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
};

beforeEach(() => {
  resetInboxOffsetForTests();
  process.env.TELEGRAM_BOT_TOKEN = "123:fake";
  process.env.TELEGRAM_CHAT_ID = "-100999";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of [
    ["TELEGRAM_BOT_TOKEN", original.token],
    ["TELEGRAM_CHAT_ID", original.chatId],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

/** คืนรายการเหตุการณ์ครั้งแรก แล้วคืนว่างในครั้งถัด ๆ ไป */
function stubUpdates(updates: unknown[]) {
  const urls: string[] = [];
  const spy = vi.fn(async (url: string) => {
    urls.push(url);
    const first = urls.length === 1;
    return new Response(JSON.stringify({ ok: true, result: first ? updates : [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", spy);
  return { spy, urls };
}

describe("การยืนยันตำแหน่งที่อ่านถึง", () => {
  test("อ่านครั้งแรกไม่ส่ง offset แล้วยืนยันด้วย offset หลังประมวลผล", async () => {
    const { urls } = stubUpdates([{ update_id: 500 }, { update_id: 501 }]);

    const outcome = await processTelegramInbox();

    expect(outcome.processed).toBe(2);
    // ครั้งแรกยังไม่รู้ว่าอ่านถึงไหน จึงไม่ส่ง offset
    expect(urls[0]).not.toContain("offset=");
    // ครั้งที่สองคือการยืนยัน ต้องเป็นหมายเลขถัดจากตัวสุดท้าย
    expect(urls[1]).toContain("offset=502");
  });

  test("ไม่มีเหตุการณ์ ไม่ต้องยิงยืนยันให้เปลือง", async () => {
    const { spy } = stubUpdates([]);
    const outcome = await processTelegramInbox();

    expect(outcome.processed).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("เหตุการณ์ที่ไม่รู้จักถูกนับว่าอ่านแล้ว จะได้ไม่วนซ้ำ", async () => {
    const { urls } = stubUpdates([
      { update_id: 10, message: { text: "สวัสดี" } },
      { update_id: 11, callback_query: { id: "q1", data: "ไม่ใช่รูปแบบที่รู้จัก" } },
    ]);

    const outcome = await processTelegramInbox();

    expect(outcome.ignored).toBe(2);
    expect(urls[1]).toContain("offset=12");
  });
});

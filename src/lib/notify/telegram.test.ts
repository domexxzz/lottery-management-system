import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clampMessage,
  getTelegramChatInfo,
  isTelegramConfigured,
  redactToken,
  sendTelegramMessage,
  TELEGRAM_MAX_MESSAGE_LENGTH,
} from "./telegram";

/**
 * ตัวส่ง Telegram
 *
 * เรื่องที่ห้ามพลาดคือโทเค็นต้องไม่หลุดลง log
 * เพราะ Telegram ใส่โทเค็นไว้ใน URL ข้อความ error จึงมีโอกาสพามันออกมาด้วย
 */

const FAKE_TOKEN = "123456789:AA-fake-token-for-tests-only";

const original = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  baseUrl: process.env.TELEGRAM_BASE_URL,
};

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = FAKE_TOKEN;
  process.env.TELEGRAM_CHAT_ID = "-1001234567890";
  delete process.env.TELEGRAM_BASE_URL;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of [
    ["TELEGRAM_BOT_TOKEN", original.token],
    ["TELEGRAM_CHAT_ID", original.chatId],
    ["TELEGRAM_BASE_URL", original.baseUrl],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function stub(response: { status?: number; body: unknown }) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(response.body), {
        status: response.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

describe("การตั้งค่า", () => {
  test("ต้องมีทั้งโทเค็นและ chat id จึงถือว่าพร้อม", () => {
    expect(isTelegramConfigured()).toBe(true);

    delete process.env.TELEGRAM_CHAT_ID;
    expect(isTelegramConfigured()).toBe(false);

    process.env.TELEGRAM_CHAT_ID = "   ";
    expect(isTelegramConfigured()).toBe(false);
  });

  test("ยังไม่ตั้งค่าแล้วเรียกส่ง ต้องไม่ยิงออกไปและไม่โยน error", async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const spy = stub({ body: { ok: true } });

    const result = await sendTelegramMessage("ทดสอบ");

    expect(result).toEqual({
      ok: false,
      reason: "NOT_CONFIGURED",
      detail: expect.stringContaining("TELEGRAM_BOT_TOKEN"),
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("คำขอที่ยิงไปยัง Telegram", () => {
  test("ยิง sendMessage พร้อม chat id และข้อความ", async () => {
    const spy = stub({ body: { ok: true } });

    const result = await sendTelegramMessage("มีสลิปเข้ามาใหม่");

    expect(result).toEqual({ ok: true });
    const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${FAKE_TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.chat_id).toBe("-1001234567890");
    expect(body.text).toBe("มีสลิปเข้ามาใหม่");
    expect(body.disable_web_page_preview).toBe(true);
    // ไม่ส่ง parse_mode เพราะชื่อรอบและรหัสลูกค้าเป็นข้อความอิสระ
    expect(body.parse_mode).toBeUndefined();
  });

  test("โทเค็นผิดถูกแยกเป็น AUTH_FAILED", async () => {
    stub({ status: 401, body: { ok: false, description: "Unauthorized" } });
    const result = await sendTelegramMessage("ทดสอบ");
    expect(result).toMatchObject({ ok: false, reason: "AUTH_FAILED" });
  });

  test("Telegram ตอบ 404 เมื่อโทเค็นไม่มีอยู่จริง ก็ต้องถือเป็นปัญหาโทเค็น", async () => {
    stub({ status: 404, body: { ok: false, description: "Not Found" } });
    const result = await sendTelegramMessage("ทดสอบ");
    expect(result).toMatchObject({ ok: false, reason: "AUTH_FAILED" });
  });

  test("chat id ผิดเป็น REQUEST_FAILED ไม่ใช่ปัญหาโทเค็น", async () => {
    stub({ status: 400, body: { ok: false, description: "Bad Request: chat not found" } });
    const result = await sendTelegramMessage("ทดสอบ");
    expect(result).toMatchObject({ ok: false, reason: "REQUEST_FAILED" });
    expect(result).toMatchObject({ detail: expect.stringContaining("chat not found") });
  });

  test("HTTP 200 แต่ ok:false ก็ถือว่าไม่สำเร็จ", async () => {
    stub({ status: 200, body: { ok: false, description: "something went wrong" } });
    expect(await sendTelegramMessage("ทดสอบ")).toMatchObject({ ok: false });
  });

  test("เครือข่ายล้มคืนค่าเป็นผลลัพธ์ ไม่โยน error ใส่ผู้เรียก", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );
    const result = await sendTelegramMessage("ทดสอบ");
    expect(result).toMatchObject({ ok: false, reason: "REQUEST_FAILED" });
  });
});

describe("ไม่ให้โทเค็นหลุด", () => {
  test("โทเค็นที่ติดมาในข้อความ error ถูกแทนที่", () => {
    expect(redactToken(`คำขอไปที่ /bot${FAKE_TOKEN}/sendMessage ล้มเหลว`)).not.toContain(
      FAKE_TOKEN,
    );
  });

  test("ซ่อนรูปแบบโทเค็นได้แม้ไม่ใช่ตัวที่ตั้งไว้", () => {
    const other = "bot987654321:ZZ-some-other-token";
    expect(redactToken(`error at ${other}`)).toContain("bot<redacted>");
    expect(redactToken(`error at ${other}`)).not.toContain("987654321:ZZ");
  });

  test("ผลลัพธ์ที่คืนออกไปไม่มีโทเค็นอยู่เลย", async () => {
    stub({
      status: 401,
      body: { ok: false, description: `Unauthorized for /bot${FAKE_TOKEN}/sendMessage` },
    });
    const result = await sendTelegramMessage("ทดสอบ");
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
  });
});

describe("ความยาวข้อความ", () => {
  test("ข้อความปกติไม่ถูกแตะ", () => {
    expect(clampMessage("สั้น ๆ")).toBe("สั้น ๆ");
  });

  test("ข้อความยาวเกินถูกตัดพร้อมบอกว่าถูกตัด", () => {
    const clamped = clampMessage("ก".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 500));
    expect(clamped.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
    expect(clamped).toContain("ถูกตัด");
  });

  test("ตัดก่อนส่งจริง ไม่ปล่อยให้ Telegram ปฏิเสธทั้งข้อความ", async () => {
    const spy = stub({ body: { ok: true } });
    await sendTelegramMessage("ข".repeat(TELEGRAM_MAX_MESSAGE_LENGTH + 100));

    const body = JSON.parse(
      String((spy.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as { text: string };
    expect(body.text.length).toBeLessThanOrEqual(TELEGRAM_MAX_MESSAGE_LENGTH);
  });
});

describe("ยืนยันปลายทางก่อนส่ง", () => {
  test("อ่านชื่อและชนิดของกลุ่มได้", async () => {
    stub({
      body: {
        ok: true,
        result: { id: -1001234567890, type: "supergroup", title: "ทีมตรวจหลักฐาน" },
      },
    });

    const info = await getTelegramChatInfo();
    expect(info).toEqual({
      ok: true,
      chat: { id: -1001234567890, type: "supergroup", title: "ทีมตรวจหลักฐาน" },
    });
  });

  test("แชทส่วนตัวใช้ชื่อผู้ใช้แทนชื่อกลุ่ม", async () => {
    stub({ body: { ok: true, result: { id: 8627938804, type: "private", first_name: "Kritamet" } } });
    const info = await getTelegramChatInfo();
    expect(info).toMatchObject({ ok: true, chat: { type: "private", title: "Kritamet" } });
  });

  test("บอทไม่ได้อยู่ในกลุ่มแล้ว ไม่ถือว่าโทเค็นผิด", async () => {
    stub({ status: 400, body: { ok: false, description: "Bad Request: chat not found" } });
    const info = await getTelegramChatInfo();
    expect(info).toMatchObject({ ok: false, reason: "REQUEST_FAILED" });
  });

  test("ยังไม่ตั้งค่าแล้วไม่ยิงออกไป", async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const spy = stub({ body: { ok: true, result: {} } });
    expect(await getTelegramChatInfo()).toMatchObject({ ok: false, reason: "NOT_CONFIGURED" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("ไม่มีโทเค็นหลุดในผลลัพธ์แม้ตอนล้มเหลว", async () => {
    stub({
      status: 401,
      body: { ok: false, description: `Unauthorized /bot${FAKE_TOKEN}/getChat` },
    });
    expect(JSON.stringify(await getTelegramChatInfo())).not.toContain(FAKE_TOKEN);
  });
});

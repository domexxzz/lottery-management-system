import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  channelEnvName,
  channelLabel,
  channelThreadId,
  isChannelConfigured,
  NOTIFY_CHANNELS,
  sendToChannel,
} from "./channels";

/**
 * ห้องปลายทาง
 *
 * สิ่งที่ต้องไม่พลาดคือส่งผิดห้อง เพราะสลิปลูกค้าไปโผล่ห้องสรุปรายวัน
 * แล้วไม่มีใครสังเกตคือความเสียหายที่เงียบมาก
 */

const original: Record<string, string | undefined> = {};
const KEYS = [
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "TELEGRAM_TOPIC_DAILY_SUMMARY",
  "TELEGRAM_TOPIC_EVIDENCE",
] as const;

beforeEach(() => {
  for (const key of KEYS) original[key] = process.env[key];
  process.env.TELEGRAM_BOT_TOKEN = "123:fake";
  process.env.TELEGRAM_CHAT_ID = "-1001234567890";
  delete process.env.TELEGRAM_TOPIC_DAILY_SUMMARY;
  delete process.env.TELEGRAM_TOPIC_EVIDENCE;
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function stubOk() {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function sentBody(spy: { mock: { calls: unknown[] } }): Record<string, unknown> {
  const calls = spy.mock.calls as unknown as [string, RequestInit][];
  return JSON.parse(String(calls[calls.length - 1]![1].body));
}

describe("การจับคู่ห้องกับ environment", () => {
  test("มีสองห้องและชื่อไม่ซ้ำ", () => {
    expect([...NOTIFY_CHANNELS]).toEqual(["daily-summary", "evidence"]);
    expect(channelEnvName("daily-summary")).toBe("TELEGRAM_TOPIC_DAILY_SUMMARY");
    expect(channelEnvName("evidence")).toBe("TELEGRAM_TOPIC_EVIDENCE");
    expect(channelLabel("evidence")).toContain("หลักฐาน");
  });

  test("ยังไม่ตั้งเลขห้อง ถือว่าไม่ได้ตั้งค่า", () => {
    expect(isChannelConfigured("evidence")).toBe(false);
    expect(channelThreadId("evidence")).toBeUndefined();
  });

  test("เลขห้องที่พิมพ์ผิดถูกมองว่าไม่ได้ตั้ง ดีกว่าส่งผิดห้อง", () => {
    for (const bad of ["abc", "-5", "12.5", "1 2", ""]) {
      process.env.TELEGRAM_TOPIC_EVIDENCE = bad;
      expect(channelThreadId("evidence"), bad).toBeUndefined();
    }
  });

  test("เลขห้องที่ถูกต้องถูกอ่านมาใช้", () => {
    process.env.TELEGRAM_TOPIC_EVIDENCE = "42";
    expect(channelThreadId("evidence")).toBe("42");
    expect(isChannelConfigured("evidence")).toBe(true);
  });
});

describe("การส่งเข้าห้อง", () => {
  test("ส่งเข้าห้องที่ตั้งไว้ด้วย message_thread_id", async () => {
    process.env.TELEGRAM_TOPIC_EVIDENCE = "42";
    const spy = stubOk();

    await sendToChannel("evidence", "มีสลิปใหม่");

    expect(sentBody(spy)).toMatchObject({
      chat_id: "-1001234567890",
      text: "มีสลิปใหม่",
      message_thread_id: 42,
    });
  });

  test("ไม่ได้ตั้งห้อง ส่งเข้าห้องรวมโดยไม่ใส่ message_thread_id", async () => {
    const spy = stubOk();
    await sendToChannel("daily-summary", "สรุปวันนี้");
    expect(sentBody(spy)).not.toHaveProperty("message_thread_id");
  });

  test("สองห้องไปคนละ thread ไม่ปนกัน", async () => {
    process.env.TELEGRAM_TOPIC_DAILY_SUMMARY = "7";
    process.env.TELEGRAM_TOPIC_EVIDENCE = "9";
    const spy = stubOk();

    await sendToChannel("daily-summary", "สรุป");
    const first = sentBody(spy);
    await sendToChannel("evidence", "สลิป");
    const second = sentBody(spy);

    expect(first.message_thread_id).toBe(7);
    expect(second.message_thread_id).toBe(9);
  });
});

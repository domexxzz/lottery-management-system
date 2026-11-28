import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { runPromotionExpiryAlerts } from "./promotion-expiry";

/**
 * แจ้งเตือนโปรโมชั่นใกล้หมดอายุ
 *
 * สิ่งที่ชุดนี้ต้องพิสูจน์
 *   1. เตือนเฉพาะที่ใกล้หมดจริง ไม่ใช่ทุกคนที่มีโปรโมชั่น
 *   2. เรียกซ้ำกี่ครั้งก็ได้ข้อความชุดเดียว เพราะ scheduler เรียกถี่
 *   3. ส่งไม่สำเร็จต้องไม่ถูกบันทึกว่าส่งแล้ว ไม่งั้นเงียบไปตลอดช่วงที่เหลือ
 */

let f: Fixtures;

const originalEnv = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  topic: process.env.TELEGRAM_TOPIC_DAILY_SUMMARY,
};

beforeEach(async () => {
  f = await freshFixtures();
  process.env.TELEGRAM_BOT_TOKEN = "123:fake";
  process.env.TELEGRAM_CHAT_ID = "-100999";
  process.env.TELEGRAM_TOPIC_DAILY_SUMMARY = "7";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of [
    ["TELEGRAM_BOT_TOKEN", originalEnv.token],
    ["TELEGRAM_CHAT_ID", originalEnv.chatId],
    ["TELEGRAM_TOPIC_DAILY_SUMMARY", originalEnv.topic],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

function stub(ok: boolean) {
  const spy = vi.fn(async () => new Response(JSON.stringify(ok ? { ok: true } : { ok: false, description: "boom" }), {
    status: ok ? 200 : 500,
    headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function lastText(spy: { mock: { calls: unknown[] } }): string {
  const calls = spy.mock.calls as unknown as [string, RequestInit][];
  return (JSON.parse(String(calls[calls.length - 1]![1].body)) as { text: string }).text;
}

async function setPromotion(agentId: string, endsOn: string) {
  await prisma.agent.update({
    where: { id: agentId },
    data: {
      commissionPromotionStartsOn: new Date("2026-12-01T00:00:00.000Z"),
      commissionPromotionEndsOn: new Date(`${endsOn}T00:00:00.000Z`),
      commissionPromotionThaiMinGross: "20000",
      commissionPromotionThaiRate: "32",
    },
  });
}

function alertCount(): Promise<number> {
  return prisma.auditEvent.count({
    where: { action: "NOTIFICATION_SENT", entityType: "AgentCommissionPromotion" },
  });
}

/** 09:00 เวลาไทยของวันที่กำหนด เลี่ยงกรณีคาบเกี่ยวเที่ยงคืน */
const at = (day: string) => new Date(`${day}T09:00:00.000+07:00`);

describe("เตือนก่อนโปรโมชั่นหมดอายุ", () => {
  test("เตือนเมื่อเหลือไม่เกินสามวัน และบอกว่าเหลือกี่วัน", async () => {
    await setPromotion(f.agents.agent1.id, "2026-12-20");
    const spy = stub(true);

    const outcome = await runPromotionExpiryAlerts(at("2026-12-18"));
    expect(outcome.notified).toBe(1);
    const text = lastText(spy);
    expect(text).toContain(f.agents.agent1.code);
    expect(text).toContain("เหลือ 2 วัน");
  });

  test("ยังไม่ใกล้หมดไม่ต้องเตือน และหมดไปแล้วก็ไม่ต้องเตือนย้อนหลัง", async () => {
    await setPromotion(f.agents.agent1.id, "2026-12-20");
    stub(true);

    expect((await runPromotionExpiryAlerts(at("2026-12-10"))).notified).toBe(0);
    expect((await runPromotionExpiryAlerts(at("2026-12-25"))).notified).toBe(0);
    expect(await alertCount()).toBe(0);
  });

  test("วันสุดท้ายเตือนแยกจากการเตือนล่วงหน้า และเตือนสองจังหวะไม่ถือว่าซ้ำ", async () => {
    await setPromotion(f.agents.agent1.id, "2026-12-20");
    const spy = stub(true);

    await runPromotionExpiryAlerts(at("2026-12-18"));
    const second = await runPromotionExpiryAlerts(at("2026-12-20"));
    expect(second.notified).toBe(1);
    expect(lastText(spy)).toContain("วันนี้เป็นวันสุดท้าย");
    expect(await alertCount()).toBe(2);
  });

  test("เรียกซ้ำในวันเดิมไม่ส่งซ้ำ", async () => {
    await setPromotion(f.agents.agent1.id, "2026-12-20");
    const spy = stub(true);

    await runPromotionExpiryAlerts(at("2026-12-18"));
    const again = await runPromotionExpiryAlerts(at("2026-12-18"));
    expect(again.notified).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await alertCount()).toBe(1);
  });

  test("เลื่อนวันหมดอายุออกไป ต้องเตือนใหม่เมื่อใกล้ถึงรอบใหม่", async () => {
    await setPromotion(f.agents.agent1.id, "2026-12-20");
    stub(true);
    await runPromotionExpiryAlerts(at("2026-12-18"));

    await setPromotion(f.agents.agent1.id, "2026-12-31");
    const outcome = await runPromotionExpiryAlerts(at("2026-12-29"));
    expect(outcome.notified).toBe(1);
  });

  test("ส่งไม่สำเร็จต้องไม่บันทึกว่าส่งแล้ว รอบถัดไปจึงยังเตือนได้", async () => {
    await setPromotion(f.agents.agent1.id, "2026-12-20");
    stub(false);

    const failed = await runPromotionExpiryAlerts(at("2026-12-18"));
    expect(failed.notified).toBe(0);
    expect(failed.skippedReason).toBe("SEND_FAILED");
    expect(await alertCount()).toBe(0);

    stub(true);
    expect((await runPromotionExpiryAlerts(at("2026-12-18"))).notified).toBe(1);
  });

  test("ไม่ได้ตั้งช่องทาง Telegram ไว้ ก็ไม่ล้มทั้งงาน", async () => {
    delete process.env.TELEGRAM_TOPIC_DAILY_SUMMARY;
    await setPromotion(f.agents.agent1.id, "2026-12-20");
    const spy = stub(true);

    const outcome = await runPromotionExpiryAlerts(at("2026-12-18"));
    expect(outcome.skippedReason).toBe("NOT_CONFIGURED");
    expect(spy).not.toHaveBeenCalled();
  });
});

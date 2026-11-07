import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { drawSummary } from "@/lib/reports/service";
import { enterResult } from "@/lib/results/service";
import { calculateSettlement } from "@/lib/settlement/service";
import { localDateKey, runDailySummary } from "./daily-summary";

/**
 * สรุปรายวัน
 *
 * สิ่งที่ชุดนี้ต้องพิสูจน์
 *   1. ตัวเลขตรงกับหน้ารายงานเป๊ะ ๆ ไม่ใช่คำนวณใหม่แล้วบังเอิญใกล้เคียง
 *   2. ส่งวันละครั้ง เรียกถี่แค่ไหนก็ไม่ซ้ำ
 *   3. ส่งไม่สำเร็จต้องไม่ถูกบันทึกว่าส่งแล้ว ไม่งั้นเงียบไปทั้งวัน
 */

let f: Fixtures;

const originalEnv = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  topic: process.env.TELEGRAM_TOPIC_DAILY_SUMMARY,
  appUrl: process.env.APP_BASE_URL,
};

beforeEach(async () => {
  f = await freshFixtures();
  process.env.TELEGRAM_BOT_TOKEN = "123:fake";
  process.env.TELEGRAM_CHAT_ID = "-100999";
  process.env.TELEGRAM_TOPIC_DAILY_SUMMARY = "7";
  process.env.APP_BASE_URL = "https://lottery.example.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of [
    ["TELEGRAM_BOT_TOKEN", originalEnv.token],
    ["TELEGRAM_CHAT_ID", originalEnv.chatId],
    ["TELEGRAM_TOPIC_DAILY_SUMMARY", originalEnv.topic],
    ["APP_BASE_URL", originalEnv.appUrl],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

function stub(ok: boolean) {
  const spy = vi.fn(
    async () =>
      new Response(JSON.stringify(ok ? { ok: true } : { ok: false, description: "boom" }), {
        status: ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

function sent(spy: { mock: { calls: unknown[] } }): { text: string; thread?: number } {
  const calls = spy.mock.calls as unknown as [string, RequestInit][];
  const body = JSON.parse(String(calls[calls.length - 1]![1].body)) as {
    text: string;
    message_thread_id?: number;
  };
  return { text: body.text, thread: body.message_thread_id };
}

async function summaryAuditCount(): Promise<number> {
  return prisma.auditEvent.count({
    where: { action: "NOTIFICATION_SENT", entityType: "DailySummary" },
  });
}

describe("ตัวเลขตรงกับหน้ารายงาน", () => {
  test("ยอดขายและจำนวนบิลเท่ากับ drawSummary", async () => {
    const { billId } = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
    });
    await replaceDraftItems(f.actors.AGENT1, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "250" },
    ]);
    await confirmBill(f.actors.AGENT1, billId);

    const spy = stub(true);
    const outcome = await runDailySummary();
    expect(outcome.sent).toBe(true);

    const report = await drawSummary(f.actors.OWNER, f.draw.id);
    const { text, thread } = sent(spy);

    expect(text).toContain(report.gross.toFixed(2));
    expect(text).toContain("1 บิล");
    expect(text).toContain("งวดทดสอบ");
    // ยังไม่คำนวณ ต้องบอกตรง ๆ ไม่ใช่โชว์สุทธิเป็น 0
    expect(text).toContain("ยังไม่ได้คำนวณ Settlement");
    // เข้าห้องสรุปรายวัน ไม่ใช่ห้องตรวจหลักฐาน
    expect(thread).toBe(7);
  });

  test("คำนวณแล้วแสดงสุทธิที่หักคอมแล้ว", async () => {
    const { billId } = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
    });
    await replaceDraftItems(f.actors.AGENT1, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    await confirmBill(f.actors.AGENT1, billId);
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "999",
    });
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    const spy = stub(true);
    await runDailySummary();

    const report = await drawSummary(f.actors.OWNER, f.draw.id);
    const { text } = sent(spy);
    expect(text).toContain(`สุทธิ ${report.net.toFixed(2)}`);
    expect(text).toContain(`คอม ${report.commission.toFixed(2)}`);
    expect(text).not.toContain("ยังไม่ได้คำนวณ");
  });
});

describe("งานค้างและความเสี่ยง", () => {
  test("นับหลักฐานรอตรวจและบอกเลขเสี่ยงสูงสุด", async () => {
    const { billId } = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้า",
    });
    await replaceDraftItems(f.actors.AGENT1, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    await confirmBill(f.actors.AGENT1, billId);
    await prisma.billAttachment.create({
      data: {
        organizationId: f.org.id,
        billId,
        type: "PAYMENT_EVIDENCE",
        storageKey: "evidence/daily-1.webp",
        originalName: "slip.jpg",
        mimeType: "image/webp",
        fileSize: 10,
        checksum: "daily-1",
        uploadedById: f.users.agentUser1.id,
        status: "PENDING",
      },
    });

    const spy = stub(true);
    await runDailySummary();
    const { text } = sent(spy);

    expect(text).toContain("หลักฐานรอตรวจ 1");
    // 100 × 900
    expect(text).toContain("90000.00");
    expect(text).toContain("เลข 123");
  });

  test("ไม่มีงานค้างบอกว่าไม่มี ไม่ใช่เงียบ", async () => {
    const spy = stub(true);
    await runDailySummary();
    expect(sent(spy).text).toContain("งานค้าง: ไม่มี");
  });

  test("ไม่มีภาระผูกพันบอกตรง ๆ ไม่หยิบเลขจากที่อื่นมาแทน", async () => {
    const spy = stub(true);
    await runDailySummary();
    expect(sent(spy).text).toContain("ไม่มีภาระผูกพันค้างอยู่");
  });
});

describe("ส่งวันละครั้ง", () => {
  test("เรียกซ้ำในวันเดียวกันไม่ส่งอีก", async () => {
    const spy = stub(true);

    expect(await runDailySummary()).toMatchObject({ sent: true });
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await runDailySummary();
    expect(second).toMatchObject({ sent: false, skippedReason: "ALREADY_SENT" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await summaryAuditCount()).toBe(1);
  });

  test("วันถัดไปส่งใหม่", async () => {
    const spy = stub(true);
    const today = new Date();
    await runDailySummary(today);

    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
    expect(await runDailySummary(tomorrow)).toMatchObject({ sent: true });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(await summaryAuditCount()).toBe(2);
  });

  test("ใช้วันที่ตามเขตเวลาขององค์กร ไม่ใช่ของเครื่องที่รัน", () => {
    // เที่ยงคืนครึ่งที่กรุงเทพฯ ยังเป็นเมื่อวานใน UTC
    const instant = new Date("2026-11-07T17:30:00Z");
    expect(localDateKey(instant, "Asia/Bangkok")).toBe("2026-11-08");
    expect(localDateKey(instant, "UTC")).toBe("2026-11-07");
  });
});

describe("ส่งไม่สำเร็จ", () => {
  test("ไม่บันทึกว่าส่งแล้ว จึงได้ลองใหม่", async () => {
    stub(false);
    const failed = await runDailySummary();

    expect(failed).toMatchObject({ sent: false, skippedReason: "SEND_FAILED" });
    expect(await summaryAuditCount()).toBe(0);

    const spy = stub(true);
    expect(await runDailySummary()).toMatchObject({ sent: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await summaryAuditCount()).toBe(1);
  });
});

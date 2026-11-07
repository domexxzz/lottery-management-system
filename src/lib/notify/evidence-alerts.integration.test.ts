import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { AttachmentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import { runEvidenceAlerts } from "./evidence-alerts";

/** storage ปลอม คืนรูปหนึ่งไบต์ พอให้เส้นทางส่งรูปทำงานโดยไม่ต้องมี MinIO */
const fakeStorage = {
  download: async () => Buffer.from([0xff]),
} as unknown as PrivateObjectStorage;

/** storage ที่อ่านไฟล์ไม่ได้ ใช้ทดสอบว่ายังแจ้งเตือนต่อได้ */
const brokenStorage = {
  download: async () => {
    throw new Error("object missing");
  },
} as unknown as PrivateObjectStorage;

const run = (limit = 20) => runEvidenceAlerts(limit, fakeStorage);

/**
 * งานแจ้งเตือนหลักฐาน
 *
 * สิ่งที่ชุดนี้ต้องพิสูจน์ เรียงตามความสำคัญ
 *   1. ส่งไม่สำเร็จต้องไม่ถูกบันทึกว่าแจ้งแล้ว ไม่งั้นรายการนั้นหายเงียบตลอดกาล
 *   2. รันซ้ำต้องไม่ส่งซ้ำ เพราะ scheduler เรียกถี่และอาจรันซ้อน
 *   3. ข้อมูลที่ออกไปต้องจำกัดตามที่ตกลง ไม่มีรหัสลูกค้าและไม่มีลิงก์ไฟล์
 */

let f: Fixtures;

const originalEnv = {
  token: process.env.TELEGRAM_BOT_TOKEN,
  chatId: process.env.TELEGRAM_CHAT_ID,
  appUrl: process.env.APP_BASE_URL,
};

beforeEach(async () => {
  f = await freshFixtures();
  process.env.TELEGRAM_BOT_TOKEN = "123:fake";
  process.env.TELEGRAM_CHAT_ID = "-100999";
  process.env.APP_BASE_URL = "https://lottery.example.test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, value] of [
    ["TELEGRAM_BOT_TOKEN", originalEnv.token],
    ["TELEGRAM_CHAT_ID", originalEnv.chatId],
    ["APP_BASE_URL", originalEnv.appUrl],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

function stubTelegram(outcome: { ok: boolean; status?: number; description?: string }) {
  const spy = vi.fn(
    async () =>
      new Response(
        JSON.stringify(
          outcome.ok ? { ok: true } : { ok: false, description: outcome.description ?? "failed" },
        ),
        {
          status: outcome.status ?? (outcome.ok ? 200 : 500),
          headers: { "Content-Type": "application/json" },
        },
      ),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

/**
 * ข้อความที่ส่งออกไป
 *
 * ตอนนี้ส่งเป็นรูปพร้อมคำบรรยาย ซึ่งเป็น multipart ไม่ใช่ JSON
 * ถ้าอ่านรูปไม่ได้จะตกไปเป็นข้อความธรรมดาแบบ JSON จึงต้องรองรับทั้งสองแบบ
 */
function sentText(spy: { mock: { calls: unknown[] } }, index = -1): string {
  const calls = spy.mock.calls as unknown as [string, RequestInit][];
  const call = calls.at(index)!;
  const body = call[1].body;
  if (body instanceof FormData) return String(body.get("caption") ?? "");
  return (JSON.parse(String(body)) as { text: string }).text;
}

function buttonsOf(spy: { mock: { calls: unknown[] } }, index = -1): string {
  const calls = spy.mock.calls as unknown as [string, RequestInit][];
  const body = calls.at(index)![1].body;
  if (body instanceof FormData) return String(body.get("reply_markup") ?? "");
  return JSON.stringify((JSON.parse(String(body)) as { reply_markup?: unknown }).reply_markup ?? "");
}

let storageKeySeed = 0;

async function confirmedBillWithAttachment(input: {
  customerReference: string;
  stake: string;
  type?: AttachmentType;
}) {
  const { billId } = await createDraftBill(f.actors.AGENT1, {
    drawId: f.draw.id,
    title: input.customerReference,
  });
  await replaceDraftItems(f.actors.AGENT1, billId, [
    { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: input.stake },
  ]);
  await confirmBill(f.actors.AGENT1, billId);

  storageKeySeed += 1;
  const attachment = await prisma.billAttachment.create({
    data: {
      organizationId: f.org.id,
      billId,
      type: input.type ?? "PAYMENT_EVIDENCE",
      storageKey: `evidence/test-${storageKeySeed}.webp`,
      originalName: "slip.jpg",
      mimeType: "image/webp",
      fileSize: 1024,
      checksum: `checksum-${storageKeySeed}`,
      uploadedById: f.users.agentUser1.id,
      status: "PENDING",
    },
  });
  return { billId, attachmentId: attachment.id };
}

async function notificationCount(): Promise<number> {
  return prisma.auditEvent.count({
    where: { action: "NOTIFICATION_SENT", entityType: "BillAttachment" },
  });
}

describe("ส่งไม่สำเร็จต้องไม่ถูกนับว่าแจ้งแล้ว", () => {
  test("Telegram ล้ม ไม่บันทึก Audit และรอบหน้ายังหยิบรายการเดิมมาส่ง", async () => {
    await confirmedBillWithAttachment({ customerReference: "ลูกค้า-ก", stake: "100" });

    stubTelegram({ ok: false, status: 500, description: "internal error" });
    const failed = await run();

    expect(failed).toMatchObject({ pending: 1, notified: 0, skippedReason: "SEND_FAILED" });
    expect(await notificationCount()).toBe(0);

    // รอบถัดไปที่ส่งได้ ต้องได้รายการเดิมกลับมา
    const spy = stubTelegram({ ok: true });
    const retried = await run();

    expect(retried).toMatchObject({ pending: 1, notified: 1 });
    expect(await notificationCount()).toBe(1);
    expect(sentText(spy)).toContain("รอตรวจ");
  });

  test("ยังไม่ตั้งค่า Telegram ก็ไม่บันทึกว่าแจ้งแล้ว", async () => {
    await confirmedBillWithAttachment({ customerReference: "ลูกค้า-ก", stake: "100" });
    delete process.env.TELEGRAM_BOT_TOKEN;
    const spy = stubTelegram({ ok: true });

    const outcome = await run();

    expect(outcome).toMatchObject({ notified: 0, skippedReason: "NOT_CONFIGURED" });
    expect(spy).not.toHaveBeenCalled();
    expect(await notificationCount()).toBe(0);
  });
});

describe("กันส่งซ้ำ", () => {
  test("รันซ้ำไม่ส่งรายการเดิมอีก", async () => {
    await confirmedBillWithAttachment({ customerReference: "ลูกค้า-ก", stake: "100" });

    const spy = stubTelegram({ ok: true });
    expect(await run()).toMatchObject({ notified: 1 });
    expect(spy).toHaveBeenCalledTimes(1);

    const second = await run();
    expect(second).toMatchObject({ notified: 0, skippedReason: "NOTHING_TO_SEND" });
    // ไม่ยิงออกไปเลยรอบที่สอง
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("รายการใหม่ที่เข้ามาทีหลังถูกส่ง ส่วนของเก่าไม่ซ้ำ", async () => {
    await confirmedBillWithAttachment({ customerReference: "ลูกค้า-ก", stake: "100" });
    const spy = stubTelegram({ ok: true });
    await run();

    await confirmedBillWithAttachment({ customerReference: "ลูกค้า-ข", stake: "200" });
    const outcome = await run();

    expect(outcome).toMatchObject({ pending: 1, notified: 1 });
    expect(sentText(spy)).toContain("ลูกค้า-ข".length > 0 ? "รอตรวจ" : "");
    expect(await notificationCount()).toBe(2);
  });
});

describe("ส่งทีละรายการเพราะปุ่มต้องผูกกับหลักฐานใบเดียว", () => {
  test("สามรายการยิงสามครั้ง และบันทึกครบสามแถว", async () => {
    for (const name of ["ก", "ข", "ค"]) {
      await confirmedBillWithAttachment({ customerReference: `ลูกค้า-${name}`, stake: "50" });
    }

    const spy = stubTelegram({ ok: true });
    const outcome = await run();

    expect(outcome).toMatchObject({ pending: 3, notified: 3 });
    expect(spy).toHaveBeenCalledTimes(3);
    expect(await notificationCount()).toBe(3);
  });

  test("ล้มกลางคัน รายการที่ยังไม่ส่งไม่ถูกบันทึก จึงได้ลองใหม่", async () => {
    for (const name of ["ก", "ข"]) {
      await confirmedBillWithAttachment({ customerReference: `ลูกค้า-${name}`, stake: "50" });
    }

    let call = 0;
    const spy = vi.fn(async () => {
      call += 1;
      const ok = call === 1;
      return new Response(JSON.stringify(ok ? { ok: true } : { ok: false, description: "boom" }), {
        status: ok ? 200 : 500,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", spy);

    const outcome = await run();
    expect(outcome.notified).toBe(1);
    expect(await notificationCount()).toBe(1);

    // รอบถัดไปต้องเหลือรายการที่ยังไม่ได้แจ้งอยู่หนึ่งรายการ
    stubTelegram({ ok: true });
    expect(await run()).toMatchObject({ pending: 1, notified: 1 });
    expect(await notificationCount()).toBe(2);
  });
});

describe("รูปและปุ่ม", () => {
  test("ส่งรูปพร้อมปุ่มยืนยันและตีกลับ", async () => {
    const { attachmentId } = await confirmedBillWithAttachment({
      customerReference: "ลูกค้า-ก",
      stake: "100",
    });
    const spy = stubTelegram({ ok: true });
    await run();

    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toContain("/sendPhoto");
    expect(calls[0]![1].body).toBeInstanceOf(FormData);

    const markup = buttonsOf(spy);
    expect(markup).toContain("ยืนยัน");
    expect(markup).toContain("ตีกลับ");
    // ปุ่มผูกกับบิล ไม่ใช่กับไฟล์ จึงกดครั้งเดียวจบทั้งบิล
    expect(markup).toContain("ev:bv:");
    expect(markup).toContain("ev:br:");
    expect(attachmentId.length).toBeGreaterThan(0);
  });

  test("อ่านรูปไม่ได้ ยังแจ้งเตือนต่อพร้อมปุ่มเหมือนเดิม", async () => {
    const { attachmentId } = await confirmedBillWithAttachment({
      customerReference: "ลูกค้า-ก",
      stake: "100",
    });
    const spy = stubTelegram({ ok: true });

    const outcome = await runEvidenceAlerts(20, brokenStorage);

    expect(outcome).toMatchObject({ notified: 1 });
    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toContain("/sendMessage");
    expect(sentText(spy)).toContain("อ่านไฟล์แนบไม่ได้");
    expect(buttonsOf(spy)).toContain("ev:bv:");
    expect(attachmentId.length).toBeGreaterThan(0);
  });
});

describe("ขอบเขตข้อมูลที่ส่งออก", () => {
  test("ส่งเลขบิล ยอดเงิน รหัส Agent และลิงก์ แต่ไม่ส่งรหัสลูกค้าหรือไฟล์", async () => {
    const { billId } = await confirmedBillWithAttachment({
      customerReference: "คุณสมหญิง-0898765432",
      stake: "250",
    });

    const spy = stubTelegram({ ok: true });
    await run();
    const text = sentText(spy);

    // สิ่งที่ต้องมี เพื่อให้ตัดสินใจได้ว่าต้องเข้าไปตรวจหรือยัง
    expect(text).toContain("สลิปการชำระเงิน");
    expect(text).toContain("A001");
    expect(text).toContain("250.00");
    // ลิงก์ตรงไปที่บิลใบนั้น ไม่ใส่ลิงก์คิวรวมซ้ำทุกข้อความเพราะคำบรรยายใต้รูปจำกัดความยาว
    expect(text).toContain(`https://lottery.example.test/bills/${billId}`);

    // สิ่งที่ต้องไม่มี
    expect(text).not.toContain("สมหญิง");
    expect(text).not.toContain("0898765432");
    expect(text).not.toContain("evidence/test-");
    expect(text).not.toContain("checksum");
  });

  test("แยกชนิดหลักฐานการสั่งซื้อออกจากสลิป", async () => {
    await confirmedBillWithAttachment({
      customerReference: "ลูกค้า-ก",
      stake: "100",
      type: "ORDER_EVIDENCE",
    });
    const spy = stubTelegram({ ok: true });
    await run();
    expect(sentText(spy)).toContain("หลักฐานการสั่งซื้อ");
  });
});

describe("รายการที่ไม่ต้องแจ้ง", () => {
  test("หลักฐานที่ตรวจแล้วไม่ถูกแจ้ง", async () => {
    const { attachmentId } = await confirmedBillWithAttachment({
      customerReference: "ลูกค้า-ก",
      stake: "100",
    });
    await prisma.billAttachment.update({
      where: { id: attachmentId },
      data: { status: "VERIFIED" },
    });

    const spy = stubTelegram({ ok: true });
    expect(await run()).toMatchObject({ skippedReason: "NOTHING_TO_SEND" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("หลักฐานของบิลที่ยกเลิกแล้วไม่ถูกแจ้ง", async () => {
    const { billId } = await confirmedBillWithAttachment({
      customerReference: "ลูกค้า-ก",
      stake: "100",
    });
    await prisma.bill.update({ where: { id: billId }, data: { status: "CANCELLED" } });

    const spy = stubTelegram({ ok: true });
    expect(await run()).toMatchObject({ skippedReason: "NOTHING_TO_SEND" });
    expect(spy).not.toHaveBeenCalled();
  });

  test("ไม่มีอะไรรอตรวจ ไม่ยิงออกไปเลย", async () => {
    const spy = stubTelegram({ ok: true });
    expect(await run()).toMatchObject({
      pending: 0,
      notified: 0,
      skippedReason: "NOTHING_TO_SEND",
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

/** แนบหลักฐานหลายใบเข้ากับบิลเดียวกัน เพื่อทดสอบการส่งเป็นอัลบั้ม */
async function attachmentsOnOneBill(types: AttachmentType[]) {
  const { billId } = await createDraftBill(f.actors.AGENT1, {
    drawId: f.draw.id,
    title: "ลูกค้าหลายไฟล์",
  });
  await replaceDraftItems(f.actors.AGENT1, billId, [
    { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
  ]);
  await confirmBill(f.actors.AGENT1, billId);

  const ids: string[] = [];
  for (const type of types) {
    storageKeySeed += 1;
    const created = await prisma.billAttachment.create({
      data: {
        organizationId: f.org.id,
        billId,
        type,
        storageKey: `evidence/group-${storageKeySeed}.webp`,
        originalName: `file-${storageKeySeed}.jpg`,
        mimeType: "image/webp",
        fileSize: 1024,
        checksum: `group-sum-${storageKeySeed}`,
        uploadedById: f.users.agentUser1.id,
        status: "PENDING",
      },
    });
    ids.push(created.id);
  }
  return { billId, ids };
}

describe("หลักฐานของบิลเดียวกันส่งพร้อมกัน", () => {
  test("สองไฟล์ในบิลเดียว ส่งเป็นอัลบั้มแล้วตามด้วยข้อความที่มีปุ่มของทั้งสอง", async () => {
    const { billId, ids } = await attachmentsOnOneBill(["ORDER_EVIDENCE", "PAYMENT_EVIDENCE"]);
    const spy = stubTelegram({ ok: true });

    const outcome = await run();

    expect(outcome).toMatchObject({ pending: 2, notified: 2 });
    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toContain("/sendMediaGroup");
    expect(calls[1]![0]).toContain("/sendMessage");

    // อัลบั้มต้องมีสองรูป และคำบรรยายอยู่ที่รูปแรกเท่านั้น
    const media = JSON.parse(String((calls[0]![1].body as FormData).get("media"))) as {
      caption?: string;
    }[];
    expect(media).toHaveLength(2);
    expect(media[0]!.caption).toContain("2 ไฟล์");
    expect(media[1]!.caption).toBeUndefined();

    // ปุ่มชุดเดียวที่ทำงานกับทั้งบิล ไม่ใช่ปุ่มรายไฟล์
    const markup = JSON.parse(buttonsOf(spy)) as {
      inline_keyboard: { text: string; callback_data: string }[][];
    };
    expect(markup.inline_keyboard).toHaveLength(1);
    expect(markup.inline_keyboard[0]).toHaveLength(2);
    expect(JSON.stringify(markup)).toContain(`ev:bv:${billId}`);
    expect(JSON.stringify(markup)).toContain(`ev:br:${billId}`);
    expect(JSON.stringify(markup)).toContain("ยืนยันทั้งหมด");
    expect(JSON.stringify(markup)).toContain("ตีกลับทั้งหมด");
    // ไม่มีปุ่มรายไฟล์หลงเหลือ
    expect(JSON.stringify(markup)).not.toContain(`ev:v:${ids[0]}`);
  });

  test("ไฟล์เดียวยังส่งเป็นรูปเดี่ยวพร้อมปุ่มเหมือนเดิม", async () => {
    await attachmentsOnOneBill(["PAYMENT_EVIDENCE"]);
    const spy = stubTelegram({ ok: true });

    await run();

    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toContain("/sendPhoto");
  });

  test("บิลคนละใบยังแยกกลุ่มกัน ไม่ปนเป็นอัลบั้มเดียว", async () => {
    await attachmentsOnOneBill(["PAYMENT_EVIDENCE"]);
    await confirmedBillWithAttachment({ customerReference: "อีกบิล", stake: "50" });
    const spy = stubTelegram({ ok: true });

    const outcome = await run();

    expect(outcome).toMatchObject({ pending: 2, notified: 2 });
    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    // สองบิล = สองข้อความ ไม่ใช่อัลบั้มรวม
    expect(calls).toHaveLength(2);
    expect(calls[0]![0]).toContain("/sendPhoto");
    expect(calls[1]![0]).toContain("/sendPhoto");
  });

  test("อัลบั้มส่งผ่านแต่ข้อความปุ่มล้ม ไม่บันทึกว่าแจ้งแล้ว", async () => {
    await attachmentsOnOneBill(["ORDER_EVIDENCE", "PAYMENT_EVIDENCE"]);

    let call = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        call += 1;
        const ok = call === 1;
        return new Response(
          JSON.stringify(ok ? { ok: true } : { ok: false, description: "boom" }),
          { status: ok ? 200 : 500, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const outcome = await run();

    // ปุ่มไม่ถึงผู้ใช้ = ตรวจไม่ได้ จึงต้องถือว่ายังไม่ได้แจ้ง
    expect(outcome.notified).toBe(0);
    expect(await notificationCount()).toBe(0);
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { askOwnerAssistant, isOwnerChatConfigured } from "./typhoon";

let f: Fixtures;
const FAKE_KEY = "test-key-not-real";

const originalEnv = {
  key: process.env.TYPHOON_API_KEY,
  model: process.env.TYPHOON_MODEL,
  baseUrl: process.env.TYPHOON_BASE_URL,
  maxTokens: process.env.TYPHOON_MAX_COMPLETION_TOKENS,
};

beforeEach(async () => {
  f = await freshFixtures();
  process.env.TYPHOON_API_KEY = FAKE_KEY;
  delete process.env.TYPHOON_MODEL;
  delete process.env.TYPHOON_BASE_URL;
  delete process.env.TYPHOON_MAX_COMPLETION_TOKENS;
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.TYPHOON_API_KEY = originalEnv.key;
  if (originalEnv.model === undefined) delete process.env.TYPHOON_MODEL;
  else process.env.TYPHOON_MODEL = originalEnv.model;
  if (originalEnv.baseUrl === undefined) delete process.env.TYPHOON_BASE_URL;
  else process.env.TYPHOON_BASE_URL = originalEnv.baseUrl;
  if (originalEnv.maxTokens === undefined) delete process.env.TYPHOON_MAX_COMPLETION_TOKENS;
  else process.env.TYPHOON_MAX_COMPLETION_TOKENS = originalEnv.maxTokens;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function stubFetch(response: { status?: number; body: unknown }) {
  const spy = vi.fn(async () =>
    new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

const OK_BODY = {
  choices: [{ message: { role: "assistant", content: "ยอดขายรอบนี้ 100.00 บาท" } }],
};

/**
 * ตอนนี้หนึ่งคำถามยิงสองครั้ง
 *   ครั้งแรก = ขั้นวางแผน ให้โมเดลเลือกว่าจะดึงข้อมูลชุดไหน
 *   ครั้งสุดท้าย = ขั้นตอบ ซึ่งเป็นคำขอที่พก snapshot และกติกาทั้งหมดไป
 * เทสที่ตรวจเนื้อหา prompt ต้องดูคำขอสุดท้ายเสมอ
 */
function answerRequest(spy: { mock: { calls: unknown[] } }): {
  url: string;
  init: RequestInit;
  body: Record<string, never> & {
    model: string;
    messages: { role: string; content: string }[];
    temperature: number;
    max_completion_tokens: number;
    top_p: number;
    frequency_penalty: number;
    stream: boolean;
  };
} {
  const calls = spy.mock.calls as unknown as [string, RequestInit][];
  const [url, init] = calls[calls.length - 1]!;
  return { url, init, body: JSON.parse(String(init.body)) };
}

function systemPromptOf(spy: { mock: { calls: unknown[] } }): string {
  return answerRequest(spy).body.messages[0]!.content;
}

/**
 * ดึงเฉพาะเนื้อในบล็อกข้อมูล ไม่ใช่ทั้ง prompt
 *
 * ชื่อบล็อกถูกพูดถึงในข้อความกติกาด้วย การตรวจด้วย toContain ตรง ๆ จึงผ่านได้
 * ทั้งที่บล็อกข้อมูลจริงไม่ได้ถูกส่งไป ซึ่งเคยทำให้เทสเขียวแบบหลอก ๆ มาแล้ว
 */
function dataBlock(spy: { mock: { calls: unknown[] } }, name: string): string | null {
  const system = systemPromptOf(spy);
  const start = system.indexOf(`
BEGIN_${name}
`);
  const end = system.indexOf(`
END_${name}`);
  if (start === -1 || end === -1 || end < start) return null;
  return system.slice(start + `
BEGIN_${name}
`.length, end);
}

describe("คำขอที่ยิงไปยัง Typhoon", () => {
  test("ใช้ OpenAI-compatible chat completions และค่ารุ่นที่กำหนด", async () => {
    const spy = stubFetch({ body: OK_BODY });

    await askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "ยอดขายเท่าไร" }]);

    // ขั้นวางแผนหนึ่งครั้ง แล้วขั้นตอบอีกหนึ่งครั้ง
    expect(spy).toHaveBeenCalledTimes(2);
    const { url, init, body } = answerRequest(spy);
    expect(url).toBe("https://api.opentyphoon.ai/v1/chat/completions");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${FAKE_KEY}`);

    expect(body.model).toBe("typhoon-v2.5-30b-a3b-instruct");
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[1]).toEqual({ role: "user", content: "ยอดขายเท่าไร" });
    expect(body.temperature).toBe(0.6);
    expect(body.max_completion_tokens).toBe(1024);
    expect(body.top_p).toBe(0.6);
    expect(body.frequency_penalty).toBe(0);
    expect(body.stream).toBe(false);
  });

  /*
   * ชื่อและการแนะนำตัวเป็นสิ่งที่ผู้ใช้เห็น ไม่ใช่รายละเอียดภายใน
   * ถ้ามีคนแก้ prompt ทีหลังแล้วกฎนี้หลุด บอทจะกลับไปบอกว่าตัวเองเป็นโมเดลภาษา
   * โดยไม่มีอะไรเตือน เทสนี้จึงล็อกไว้
   */
  test("system prompt กำหนดให้แนะนำตัวว่าเป็นผู้ช่วยล็อตเตอรี่", async () => {
    const spy = stubFetch({ body: OK_BODY });
    await askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "คุณคือใคร" }]);

    const system = systemPromptOf(spy);
    expect(system).toContain("ผู้ช่วยล็อตเตอรี่");
    expect(system).toContain("ผมผู้ช่วยล็อตเตอรี่ครับ มีอะไรให้ช่วยบอกมาได้เลยครับ");
    // ต้องห้ามไม่ให้เผยว่าเป็นโมเดลอะไร ไม่งั้นคำตอบจะขัดกับชื่อที่ตั้งไว้
    expect(system).toContain("ห้ามบอกว่าตัวเองเป็นโมเดลภาษา");
    /*
     * กฎแนะนำตัวเคยกว้างเกินจนกลืนคำถามอื่น ถามสรุปยอดขายแล้วตอบแค่
     * "ผมผู้ช่วยล็อตเตอรี่ครับ" ไม่แตะข้อมูลเลย ต้องมีข้อห้ามกำกับไว้เสมอ
     */
    expect(system).toContain("ห้ามใช้ประโยคแนะนำตัวนั้นตอบคำถามอื่น");
    // ชื่อเดิมต้องไม่หลงเหลือ
    expect(system).not.toContain("คุณคือ Typhoon");
  });

  /*
   * หน้าจอ render ข้อความเป็น plain text ไม่แปลง Markdown
   * ถ้ากติกาข้อนี้หลุด ผู้ใช้จะเห็น ** และ | ตาราง | ดิบ ๆ ติดมากับคำตอบ
   */
  test("system prompt กำหนดรูปแบบคำตอบให้อ่านง่าย", async () => {
    const spy = stubFetch({ body: OK_BODY });
    await askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "สรุปยอดขาย" }]);

    const system = systemPromptOf(spy);
    expect(system).toContain("ขึ้นต้นด้วยคำตอบตรง ๆ หนึ่งประโยคก่อนเสมอ");
    expect(system).toContain("ห้ามใช้สัญลักษณ์ Markdown");
    expect(system).toContain("เครื่องหมายคั่นหลักพัน");
    expect(system).toContain("6 บรรทัด");
    // เคยตอบว่ารวม 16 รายการ แล้วไล่ย่อยเป็น 0 ทั้งสี่ข้อในคำตอบเดียวกัน
    expect(system).toContain("ห้ามตอบขัดกันเอง");
    // เคยพ่นชื่อฟิลด์ดิบอย่าง (evidenceReviews) ออกมาให้ผู้ใช้เห็น
    expect(system).toContain("ห้ามแสดงชื่อฟิลด์หรือชื่อตัวแปรภาษาอังกฤษ");
  });

  test("system prompt จำกัดแหล่งข้อมูลไว้ที่ฐานข้อมูลใน snapshot เท่านั้น", async () => {
    const spy = stubFetch({ body: OK_BODY });
    await askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "สรุปให้หน่อย" }]);

    const system = systemPromptOf(spy);
    expect(system).toContain("BEGIN_SNAPSHOT");
    expect(system).toContain("END_SNAPSHOT");
    expect(system).toContain("BEGIN_READ_ONLY_CONTEXT");
    expect(system).toContain("END_READ_ONLY_CONTEXT");
    expect(system).toContain('"accessMode":"READ_ONLY"');
    expect(system).toContain('"mutationToolsAvailable":false');
    expect(system).toContain("แหล่งข้อมูลเดียว");
    expect(system).toContain("ห้ามใช้ความรู้เดิมของโมเดล");
    expect(system).toContain("ไม่มีข้อมูลนี้ในระบบที่ผมเข้าถึงได้");
    expect(system).toContain("ขอบเขตองค์กรของ Owner");
    expect(system).toContain("generatedAt");
    expect(system).toContain("pendingWork");
    expect(system).toContain("เลขไหนคนซื้อเยอะสุด");
    expect(system).toContain("highDemandNumbers");
    expect(system).toContain("overall.highDemandNumbers");
    expect(system).toContain("snapshot ถูกสร้างใหม่ทุกคำถาม");
    expect(system).toContain("settlementCalculated=true แปลว่าคำนวณ Settlement แล้ว");
    expect(system).toContain("ห้ามสลับอันดับเอง");
    expect(system).toContain("ลูกค้าคนไหนถูกรางวัล");
    expect(system).toContain("currentDraw.winners.details");
    expect(system).toContain("ประวัติถูกรางวัล");
    expect(system).toContain("winnerHistory.details");
    expect(system).toContain("คำสะกดผิดเล็กน้อย");

    // บล็อกข้อมูลต้องถูกส่งไปจริง ตรวจที่เนื้อในไม่ใช่ที่ชื่อบล็อกในกติกา
    expect(dataBlock(spy, "SNAPSHOT")).toContain("profitability");
    expect(dataBlock(spy, "ANALYTICS")).toContain("riskExposure");
    expect(dataBlock(spy, "ANALYTICS")).toContain("customerBehavior");
    expect(dataBlock(spy, "MARKET")).toContain("productMix");
    expect(dataBlock(spy, "MARKET")).toContain("customerConcentration");
  });

  /**
   * ขอบเขตข้อมูลลูกค้าที่ส่งออก — เปลี่ยนโดยเจตนา
   *
   * เดิมตั้งใจไม่ส่งรหัสอ้างอิงลูกค้าออกไปเลย แต่เมื่อผู้ช่วยต้องตอบคำถามอย่าง
   * "ลูกค้าคนไหนซื้อเยอะที่สุด" หรือ "ลูกค้าคนไหนหายไป" รหัสอ้างอิงคือคำตอบเอง
   * จึงต้องส่งไป และรหัสนี้คือข้อความที่ Agent พิมพ์ในบิล ซึ่งอาจมีชื่อหรือเบอร์โทร
   *
   * เทสนี้จึงยืนยันสิ่งที่ส่งจริง เพื่อให้การเปลี่ยนขอบเขตครั้งต่อไปต้องตั้งใจแก้เทสด้วย
   * ไม่ใช่หลุดออกไปเงียบ ๆ
   */
  test("ส่งรหัสอ้างอิงลูกค้าเพื่อตอบคำถามเชิงลูกค้า และส่งสรุป Agent", async () => {
    const { createDraftBill, replaceDraftItems, confirmBill } = await import("@/lib/bills/service");
    const created = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "คุณสมหญิง-0898765432",
    });
    await replaceDraftItems(f.actors.AGENT1, created.billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "555", stake: "100" },
    ]);
    await confirmBill(f.actors.AGENT1, created.billId);

    const spy = stubFetch({ body: OK_BODY });
    await askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "สรุป" }]);

    const system = systemPromptOf(spy);
    // รหัสอ้างอิงลูกค้าถูกส่งไปโดยเจตนา เพราะเป็นคำตอบของคำถามเชิงลูกค้า
    expect(dataBlock(spy, "ANALYTICS")).toContain("คุณสมหญิง-0898765432");
    expect(system).toContain("A001");
    expect(system).toContain('"number":"555"');
  });

  test("ปรับ model และ base URL ผ่าน environment ได้", async () => {
    process.env.TYPHOON_MODEL = "typhoon-test-model";
    process.env.TYPHOON_BASE_URL = "https://example.test/v9/";
    process.env.TYPHOON_MAX_COMPLETION_TOKENS = "1536";
    const spy = stubFetch({ body: OK_BODY });

    await askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "สรุป" }]);

    const { url, body } = answerRequest(spy);
    expect(url).toBe("https://example.test/v9/chat/completions");
    expect(body.model).toBe("typhoon-test-model");
    expect(body.max_completion_tokens).toBe(1536);
  });
});

describe("ขั้นวางแผนดึงข้อมูล", () => {
  /** ตอบแผนในครั้งแรก แล้วตอบข้อความจริงในครั้งถัดไป */
  function stubPlanThenAnswer(plan: string) {
    let call = 0;
    const spy = vi.fn(async () => {
      call += 1;
      const body =
        call === 1
          ? { choices: [{ message: { role: "assistant", content: plan } }] }
          : OK_BODY;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", spy);
    return spy;
  }

  test("ครั้งแรกส่งแคตตาล็อกเครื่องมือและสั่งให้ตอบ JSON", async () => {
    const spy = stubPlanThenAnswer('{"tool":null}');
    await askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "สวัสดี" }]);

    const calls = spy.mock.calls as unknown as [string, RequestInit][];
    const plannerBody = JSON.parse(String(calls[0]![1].body)) as {
      messages: { role: string; content: string }[];
      temperature: number;
    };
    expect(plannerBody.messages[0]!.content).toContain("JSON");
    expect(plannerBody.messages[0]!.content).toContain("customer_ranking");
    // อุณหภูมิศูนย์เพราะขั้นนี้ต้องการความแน่นอน ไม่ใช่ความสร้างสรรค์
    expect(plannerBody.temperature).toBe(0);
  });

  test("แผนที่เลือกเครื่องมือจริง ทำให้คำขอตอบมีบล็อกผลคิวรีติดไปด้วย", async () => {
    const { createDraftBill, replaceDraftItems, confirmBill } = await import("@/lib/bills/service");
    const created = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้ารายใหญ่",
    });
    await replaceDraftItems(f.actors.AGENT1, created.billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "250" },
    ]);
    await confirmBill(f.actors.AGENT1, created.billId);

    const spy = stubPlanThenAnswer('{"tool":"customer_ranking","params":{"limit":3}}');
    await askOwnerAssistant(f.actors.OWNER, [
      { role: "user", content: "ลูกค้าคนไหนซื้อเยอะที่สุด" },
    ]);

    const block = dataBlock(spy, "QUERY_RESULT");
    expect(block).not.toBeNull();
    expect(block).toContain("customer_ranking");
    expect(block).toContain("ลูกค้ารายใหญ่");
    expect(block).toContain('"totalSpend":"250.00"');
    expect(block).toContain('"rowCount":1');
  });

  test("แผนที่ไม่ใช่ JSON ไม่ทำให้ทั้งคำขอพัง ยังตอบจากข้อมูลสรุปได้", async () => {
    const spy = stubPlanThenAnswer("ขอโทษครับ ผมเลือกไม่ถูก");
    const reply = await askOwnerAssistant(f.actors.OWNER, [
      { role: "user", content: "สรุปหน่อย" },
    ]);

    expect(reply).toBe("ยอดขายรอบนี้ 100.00 บาท");
    expect(dataBlock(spy, "QUERY_RESULT")).toBeNull();
  });

  test("เครื่องมือที่ไม่มีจริงถูกปฏิเสธ และแจ้งเป็น error ในบล็อกผล", async () => {
    const spy = stubPlanThenAnswer('{"tool":"delete_all_bills","params":{}}');
    await askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "ลบข้อมูลที" }]);

    const block = dataBlock(spy, "QUERY_RESULT");
    expect(block).not.toBeNull();
    expect(block).toContain("ไม่รู้จักเครื่องมือนี้");
  });
});

describe("การอ่านคำตอบและข้อผิดพลาดของ Typhoon", () => {
  test("อ่านข้อความจาก Chat Completions API ได้", async () => {
    stubFetch({ body: OK_BODY });
    await expect(
      askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "ถาม" }]),
    ).resolves.toBe("ยอดขายรอบนี้ 100.00 บาท");
  });

  test("แยกคีย์ผิดออกจากข้อผิดพลาดชนิดอื่น", async () => {
    stubFetch({ status: 401, body: { error: { message: "invalid api key" } } });
    await expect(
      askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "ถาม" }]),
    ).rejects.toThrow(/TYPHOON_AUTH_FAILED:401/);
  });

  test("ตอบสำเร็จแต่ไม่มีข้อความอ่านได้", async () => {
    stubFetch({ body: { choices: [] } });
    await expect(
      askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "ถาม" }]),
    ).rejects.toThrow("TYPHOON_EMPTY_RESPONSE");
  });

  test("ไม่ได้ตั้ง API key จะไม่ยิง request", async () => {
    delete process.env.TYPHOON_API_KEY;
    const spy = stubFetch({ body: OK_BODY });
    expect(isOwnerChatConfigured()).toBe(false);
    await expect(
      askOwnerAssistant(f.actors.OWNER, [{ role: "user", content: "ถาม" }]),
    ).rejects.toThrow("TYPHOON_NOT_CONFIGURED");
    expect(spy).not.toHaveBeenCalled();
  });
});

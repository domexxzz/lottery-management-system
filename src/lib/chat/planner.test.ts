import { describe, expect, test } from "vitest";
import { buildPlannerPrompt, parseQueryPlan } from "./planner";

/**
 * แคตตาล็อกจำลอง — ไม่ import query-tools จริง เพราะไฟล์นั้นดึง Prisma client เข้ามาด้วย
 * ซึ่งต้องมี DATABASE_URL จึงจะโหลดได้ unit test จะพังตั้งแต่ import
 * ความครบถ้วนของแคตตาล็อกจริงถูกตรวจใน query-tools.integration.test.ts แทน
 */
const CATALOG = [
  { name: "customer_ranking", description: "จัดอันดับลูกค้า ใช้ตอบ ลูกค้าคนไหนซื้อเยอะสุด" },
  { name: "draw_profit_ranking", description: "จัดอันดับรอบตามกำไรขาดทุนสุทธิ" },
];

/**
 * การแปลงคำตอบของโมเดลเป็นแผนดึงข้อมูล
 *
 * โมเดลขนาดกลางไม่เชื่อฟัง "ตอบ JSON เท่านั้น" เสมอไป
 * ชุดนี้ล็อกไว้ว่ารูปแบบที่มันมักตอบจริงต้องแปลงได้ และรูปแบบที่แปลงไม่ได้
 * ต้องตกลงเป็น tool: null อย่างสงบ ไม่ใช่โยน error จนทั้งคำขอพัง
 */

describe("parseQueryPlan", () => {
  test("JSON ล้วนตามที่สั่ง", () => {
    expect(parseQueryPlan('{"tool":"customer_ranking","params":{"limit":5}}')).toEqual({
      tool: "customer_ranking",
      params: { limit: 5 },
    });
  });

  test("ห่อด้วย code fence ก็ยังอ่านได้", () => {
    const raw = '```json\n{"tool":"draw_profit_ranking","params":{"order":"worst"}}\n```';
    expect(parseQueryPlan(raw)).toEqual({
      tool: "draw_profit_ranking",
      params: { order: "worst" },
    });
  });

  test("มีคำอธิบายนำหน้าก็ยังอ่านได้", () => {
    const raw = 'นี่คือแผนที่เลือก:\n{"tool":"number_demand","params":{}}\nหวังว่าจะช่วยได้';
    expect(parseQueryPlan(raw)).toEqual({ tool: "number_demand", params: {} });
  });

  test("tool เป็น null แปลว่าไม่ต้องดึงข้อมูลเพิ่ม", () => {
    expect(parseQueryPlan('{"tool":null}')).toEqual({ tool: null, params: {} });
  });

  test("ข้อความที่ไม่ใช่ JSON ตกลงเป็นไม่ดึงข้อมูล ไม่โยน error", () => {
    expect(parseQueryPlan("ขอโทษครับ ผมไม่เข้าใจคำถาม")).toEqual({ tool: null, params: {} });
    expect(parseQueryPlan("")).toEqual({ tool: null, params: {} });
    expect(parseQueryPlan("{ พัง")).toEqual({ tool: null, params: {} });
  });

  test("params ผิดชนิดถูกแทนที่ด้วยค่าว่าง แทนที่จะพัง", () => {
    expect(parseQueryPlan('{"tool":"number_demand","params":"ไม่ใช่ object"}')).toEqual({
      tool: "number_demand",
      params: {},
    });
  });

  test("tool ที่ยาวผิดปกติถูกปัดเป็น null", () => {
    const raw = JSON.stringify({ tool: "x".repeat(200), params: {} });
    expect(parseQueryPlan(raw).tool).toBeNull();
  });
});

describe("buildPlannerPrompt", () => {
  test("ลิสต์เครื่องมือทุกตัวให้โมเดลเห็น", () => {
    const prompt = buildPlannerPrompt(CATALOG);
    for (const tool of CATALOG) {
      expect(prompt).toContain(tool.name);
      expect(prompt).toContain(tool.description);
    }
  });

  test("สั่งให้ตอบ JSON และอธิบายกรณีอ้างถึงข้อความก่อนหน้า", () => {
    const prompt = buildPlannerPrompt(CATALOG);
    expect(prompt).toContain("JSON");
    expect(prompt).toContain("เดือนก่อน");
  });
});

import { z } from "zod";

/**
 * แผนการดึงข้อมูลที่โมเดลเสนอกลับมา
 *
 * โมเดลตอบเป็น JSON ล้วน ไม่ใช่ข้อความอิสระ เพราะเราต้องแปลงเป็นการเรียกคิวรีจริง
 * ถ้าแปลงไม่ได้ ระบบจะเดินต่อโดยไม่เรียกคิวรีใด ๆ แทนที่จะเดาว่าโมเดลหมายถึงอะไร
 */

const planSchema = z.object({
  /** null = ตอบจากข้อมูลสรุปที่มีอยู่แล้วได้ ไม่ต้องดึงเพิ่ม */
  tool: z.string().trim().min(1).max(60).nullable().catch(null),
  params: z.record(z.string(), z.unknown()).default({}).catch({}),
});

export type QueryPlan = { tool: string | null; params: Record<string, unknown> };

/**
 * ดึง JSON ออกจากคำตอบของโมเดล
 *
 * โมเดลขนาดกลางมักห่อ JSON ด้วยคำอธิบายหรือ code fence แม้จะสั่งห้ามแล้ว
 * จึงต้องเผื่อไว้ แทนที่จะล้มทั้งคำขอเพราะมีคำว่า "นี่คือแผน" นำหน้า
 */
export function parseQueryPlan(raw: string): QueryPlan {
  const text = raw.trim();
  if (text === "") return { tool: null, params: {} };

  const candidates: string[] = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(text.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(text);

  for (const candidate of candidates) {
    try {
      const parsed = planSchema.safeParse(JSON.parse(candidate));
      if (parsed.success) {
        return { tool: parsed.data.tool, params: parsed.data.params };
      }
    } catch {
      // ลองตัวถัดไป
    }
  }

  return { tool: null, params: {} };
}

/** คำสั่งที่ใช้ให้โมเดลเลือกคิวรี เขียนแยกเพื่อให้ทดสอบและแก้ถ้อยคำได้โดยไม่แตะ client */
export function buildPlannerPrompt(catalog: { name: string; description: string }[]): string {
  return [
    "คุณคือตัวเลือกคิวรีของระบบบริหารจัดการลอตเตอรี่ หน้าที่เดียวของคุณคือเลือกว่าจะดึงข้อมูลชุดไหนมาตอบคำถามล่าสุดของผู้ใช้",
    "ตอบกลับเป็น JSON อย่างเดียว ห้ามมีข้อความอื่นนอก JSON ห้ามอธิบาย",
    'รูปแบบ: {"tool": "<ชื่อเครื่องมือ>", "params": { ... }} หรือ {"tool": null} ถ้าไม่ต้องดึงข้อมูลเพิ่ม',
    "",
    "เลือก tool เป็น null เมื่อคำถามเป็นการทักทาย ถามความสามารถ หรือถามภาพรวมกว้าง ๆ ที่ข้อมูลสรุปตอบได้อยู่แล้ว",
    "ถ้าคำถามอ้างถึงสิ่งที่พูดก่อนหน้า เช่น ‘แล้วเดือนก่อนล่ะ’ ‘แล้วคนนั้นล่ะ’ ให้ดูบทสนทนาก่อนหน้าแล้วเลือกเครื่องมือกับพารามิเตอร์ที่ต่อเนื่องกัน",
    "ถ้าผู้ใช้ขออันดับหรือจำนวนรายการ ให้ใส่ limit ตามที่ขอ ถ้าไม่ได้ระบุให้ใช้ค่าเริ่มต้น",
    "",
    "เครื่องมือที่ใช้ได้:",
    ...catalog.map((tool) => `- ${tool.name}: ${tool.description}`),
  ].join("\n");
}

import { z } from "zod";
import { AppError, ValidationError } from "@/lib/errors";

const OFFICIAL_RESULT_URL = "https://www.glo.or.th/api/checking/getLotteryResult";
const DEFAULT_TIMEOUT_MS = 15_000;

const numberEntrySchema = z.object({
  value: z.string().regex(/^\d+$/),
});

const prizeSchema = z.object({
  number: z.array(numberEntrySchema).min(1),
});

const responseSchema = z.object({
  status: z.literal(true),
  response: z.object({
    result: z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      data: z.object({
        first: prizeSchema,
        last2: prizeSchema,
        last3f: prizeSchema,
        last3b: prizeSchema,
      }),
    }),
  }),
});

export type GloDrawResult = {
  drawDate: string;
  firstPrize: string;
  last2: string;
  front3: string[];
  back3: string[];
};

export type GloPrizeSuggestion = {
  values: string[];
  source: string;
};

export function bangkokDate(date: Date): string {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

export function parseGloDrawResult(payload: unknown, expectedDate: string): GloDrawResult {
  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) throw new AppError("รูปแบบข้อมูลผลรางวัลจาก GLO ไม่ถูกต้อง", 502, "GLO_INVALID_RESPONSE");

  const result = parsed.data.response.result;
  if (result.date !== expectedDate) {
    throw new AppError(`GLO ส่งผลงวด ${result.date} ซึ่งไม่ตรงกับวันที่งวด ${expectedDate}`, 502, "GLO_DATE_MISMATCH");
  }

  const firstPrize = result.data.first.number[0]!.value;
  const last2 = result.data.last2.number[0]!.value;
  const front3 = result.data.last3f.number.map((item) => item.value);
  const back3 = result.data.last3b.number.map((item) => item.value);
  if (firstPrize.length !== 6 || last2.length !== 2) {
    throw new AppError("ผลรางวัลหลักจาก GLO มีจำนวนหลักไม่ถูกต้อง", 502, "GLO_INVALID_RESULT_LENGTH");
  }
  if (
    front3.length !== 2
    || back3.length !== 2
    || front3.some((value) => value.length !== 3)
    || back3.some((value) => value.length !== 3)
  ) {
    throw new AppError("ผลรางวัล 3 ตัวจาก GLO ต้องมีประเภทละ 2 เลข และแต่ละเลขต้องมี 3 หลัก", 502, "GLO_INVALID_RESULT_LENGTH");
  }

  return {
    drawDate: result.date,
    firstPrize,
    last2,
    front3,
    back3,
  };
}

/**
 * แปลงผลทางการเป็น Rulebook ของระบบ
 *
 * เลขบนทุกตัวอ้างอิงรางวัลที่ 1 ส่วนเลขล่างอ้างอิงเลขท้าย 2 ตัวทางการ
 * รางวัลที่ 3 และ 4 ใช้เลขทางการทั้ง 2 เลขที่ GLO จับแยกโดยตรง
 */
export function buildGloPrizeSuggestions(result: GloDrawResult): Record<number, GloPrizeSuggestion> {
  const first = result.firstPrize;
  const top3 = first.slice(-3);
  const top2 = first.slice(-2);
  return {
    1: { values: [top3], source: "3 หลักท้ายของรางวัลที่ 1" },
    2: { values: [top3], source: "3 หลักท้ายของรางวัลที่ 1 (โต๊ด)" },
    3: { values: result.front3, source: "เลขหน้า 3 ตัวทางการทั้ง 2 เลข" },
    4: { values: result.back3, source: "เลขท้าย 3 ตัวทางการทั้ง 2 เลข" },
    5: { values: [top2], source: "2 หลักท้ายของรางวัลที่ 1" },
    6: { values: [result.last2], source: "เลขท้าย 2 ตัวทางการ" },
    7: { values: [top2], source: "2 หลักท้ายของรางวัลที่ 1 (โต๊ด)" },
    8: { values: [top3], source: "วิ่งจาก 3 หลักท้ายของรางวัลที่ 1" },
    9: { values: [result.last2], source: "วิ่งจากเลขท้าย 2 ตัวทางการ" },
    10: { values: [top3], source: "3 หลักท้ายของรางวัลที่ 1 (กลับ)" },
    11: { values: [top2], source: "2 หลักท้ายของรางวัลที่ 1 (กลับ)" },
    12: { values: [first.slice(-4)], source: "4 หลักท้ายของรางวัลที่ 1" },
    13: { values: [first.slice(-4)], source: "4 หลักท้ายของรางวัลที่ 1 (โต๊ด)" },
    14: { values: [first.slice(-5)], source: "5 หลักท้ายของรางวัลที่ 1" },
    15: { values: [first], source: "รางวัลที่ 1" },
    16: { values: [result.last2], source: "เลขท้าย 2 ตัวทางการ" },
  };
}

function timeoutMs(): number {
  const value = Number(process.env.GLO_API_TIMEOUT_MS);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

export async function fetchGloDrawResult(drawDate: string): Promise<GloDrawResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(drawDate)) throw new ValidationError("วันที่งวดไม่ถูกต้อง");
  const [year, month, date] = drawDate.split("-");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());

  try {
    const response = await fetch(OFFICIAL_RESULT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, month, year }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new AppError("ไม่สามารถดึงผลรางวัลจาก GLO ได้", 502, "GLO_UNAVAILABLE");
    return parseGloDrawResult(await response.json(), drawDate);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError("GLO ใช้เวลาตอบนานเกินไป กรุณาลองใหม่", 504, "GLO_TIMEOUT");
    }
    throw new AppError("ไม่สามารถเชื่อมต่อ GLO ได้ กรุณาลองใหม่", 502, "GLO_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

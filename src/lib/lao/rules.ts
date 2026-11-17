/**
 * กติกาหวยลาวและหวยลาวชุด (ฟังก์ชันล้วน ใช้ได้ทั้ง server และ client)
 *
 * ผลที่ออกจะยาวกี่หลักก็ได้ (4–6) ใช้ "4 ตัวท้าย" เป็นหลักเสมอ เช่น ออก 651234 → 1234
 * - 4 ตัว = 1234 · 3 ตัวท้าย = 234 · 3 ตัวหน้า = 123 · 2 ตัวหลัง/บน = 34 · 2 ตัวหน้า/ล่าง = 12
 * รางวัลโต๊ดใช้ MatchRule PERMUTATION เดิม ระบบสลับหลักให้เองและตัดแบบที่ซ้ำ
 *
 * ได้เฉพาะประเภทที่แทง ถูกหลายประเภทที่แทงไว้ก็ได้รวมทุกประเภท (ตรงตามการคำนวณปกติต่อรายการ)
 */

export type LaoLotteryType = "LAO" | "LAO_SET";
export type LaoSegment = "LAST4" | "LAST3" | "FIRST3" | "LAST2" | "FIRST2";

export type LaoPrizeDefinition = {
  code: number;
  name: string;
  digits: number;
  matchRule: "EXACT" | "PERMUTATION";
  lotteryType: LaoLotteryType;
  payoutRate: string;
  segment: LaoSegment;
};

export const LAO_PRIZE_TYPES: readonly LaoPrizeDefinition[] = [
  { code: 101, name: "3 ตัวตรง", digits: 3, matchRule: "EXACT", lotteryType: "LAO", payoutRate: "650.0000", segment: "LAST3" },
  { code: 102, name: "3 ตัวโต๊ด", digits: 3, matchRule: "PERMUTATION", lotteryType: "LAO", payoutRate: "100.0000", segment: "LAST3" },
  { code: 103, name: "2 ตัวบน", digits: 2, matchRule: "EXACT", lotteryType: "LAO", payoutRate: "75.0000", segment: "LAST2" },
  { code: 104, name: "2 ตัวล่าง", digits: 2, matchRule: "EXACT", lotteryType: "LAO", payoutRate: "75.0000", segment: "FIRST2" },
  { code: 201, name: "4 ตัวตรง", digits: 4, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "50000.0000", segment: "LAST4" },
  { code: 202, name: "3 ตัวท้ายตรง", digits: 3, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "17000.0000", segment: "LAST3" },
  { code: 203, name: "4 ตัวโต๊ด", digits: 4, matchRule: "PERMUTATION", lotteryType: "LAO_SET", payoutRate: "2000.0000", segment: "LAST4" },
  { code: 204, name: "3 ตัวท้ายโต๊ด", digits: 3, matchRule: "PERMUTATION", lotteryType: "LAO_SET", payoutRate: "1250.0000", segment: "LAST3" },
  { code: 205, name: "3 ตัวหน้าตรง", digits: 3, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "600.0000", segment: "FIRST3" },
  // 2 ตัวล่าง = 2 ตัวหน้าของเลข 4 ตัว · 2 ตัวบน = 2 ตัวท้าย (เดิมชื่อ 2 ตัวหน้า/2 ตัวหลัง)
  { code: 206, name: "2 ตัวล่าง", digits: 2, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "500.0000", segment: "FIRST2" },
  { code: 207, name: "2 ตัวบน", digits: 2, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "500.0000", segment: "LAST2" },
];

const SEGMENT_BY_CODE = new Map(LAO_PRIZE_TYPES.map((prize) => [prize.code, prize.segment]));

export function isLaoLottery(lotteryType: string): lotteryType is LaoLotteryType {
  return lotteryType === "LAO" || lotteryType === "LAO_SET";
}

/** ตรวจผลที่แอดมินกรอก: ตัวเลข 4–6 หลัก คืนข้อความปัญหา หรือ null ถ้าใช้ได้ */
export function laoResultProblem(raw: string): string | null {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return "ผลหวยลาวต้องเป็นตัวเลขเท่านั้น";
  if (value.length < 4 || value.length > 6) return "ผลหวยลาวต้องมี 4 ถึง 6 หลัก";
  return null;
}

export type LaoBreakdown = { last4: string; last3: string; first3: string; last2: string; first2: string };

/** แยกผลเป็นส่วนต่าง ๆ จาก 4 ตัวท้าย */
export function laoBreakdown(raw: string): LaoBreakdown {
  const problem = laoResultProblem(raw);
  if (problem) throw new Error(problem);
  const last4 = raw.trim().slice(-4);
  return {
    last4,
    last3: last4.slice(1),
    first3: last4.slice(0, 3),
    last2: last4.slice(2),
    first2: last4.slice(0, 2),
  };
}

const SEGMENT_KEY: Record<LaoSegment, keyof LaoBreakdown> = {
  LAST4: "last4",
  LAST3: "last3",
  FIRST3: "first3",
  LAST2: "last2",
  FIRST2: "first2",
};

/** เลขที่ออกของรางวัลหวยลาวรหัสนี้ หรือ null ถ้าไม่ใช่รางวัลหวยลาว */
export function laoResultForCode(code: number, raw: string): string | null {
  const segment = SEGMENT_BY_CODE.get(code);
  if (!segment) return null;
  return laoBreakdown(raw)[SEGMENT_KEY[segment]];
}

/** เวลามาตรฐานของงวดหวยลาว (เวลาไทย): เปิด 10:00 ปิด 20:00 ออกผล 20:30 */
export const LAO_DEFAULT_TIMES = { opens: "10:00", cutoff: "20:00", result: "20:30" } as const;

/** หวยลาวออกวันจันทร์–ศุกร์ */
export function isLaoDrawDay(dateText: string): boolean {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== dateText) return false;
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

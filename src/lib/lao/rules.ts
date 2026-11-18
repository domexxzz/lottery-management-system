/**
 * กติกาหวยลาวและหวยลาวชุด (ฟังก์ชันล้วน ใช้ได้ทั้ง server และ client)
 *
 * ผลที่ออกจะยาวกี่หลักก็ได้ (4–6) ใช้ "4 ตัวท้าย" เป็นหลักเสมอ เช่น ออก 651234 → 1234
 * - 4 ตัว = 1234 · 3 ตัวท้าย = 234 · 3 ตัวหน้า = 123 · 2 ตัวหลัง/บน = 34 · 2 ตัวหน้า/ล่าง = 12
 * หวยลาวปกติใช้ MatchRule ตามประเภทที่แทง ส่วนหวยลาวชุดซื้อเลข 4 หลักหนึ่งรายการ
 * ระบบตรวจ 8 รางวัลอัตโนมัติ และจ่ายเพียงรางวัลที่มีมูลค่าสูงสุด
 */

import { laoSetPackagePrice, LAO_SET_PACKAGE_PAYOUTS } from "./set-package-rates";
export { laoSetPackageLabel, laoSetPackagePrice, LAO_SET_PACKAGE_PAYOUTS, LAO_SET_PACKAGE_PRICES } from "./set-package-rates";
export type { LaoSetPackagePrice } from "./set-package-rates";

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
  isActive: boolean;
};

/** หวยลาวชุดรับแทงเป็นเลขชุด 4 หลักเพียงประเภทเดียว แล้วลุ้น 8 รางวัล */
export const LAO_SET_ACTIVE_CODES = [201] as const;

export type LaoSetPrizeKey = "EXACT_4" | "PERMUTATION_4" | "LAST_3_EXACT" | "LAST_3_PERMUTATION" | "FIRST_3_EXACT" | "FIRST_3_PERMUTATION" | "FIRST_2" | "LAST_2";

export type LaoSetWinningPrize = {
  key: LaoSetPrizeKey;
  label: string;
  payout: number;
};

export const LAO_SET_PRIZE_LABELS: Record<LaoSetPrizeKey, string> = {
  EXACT_4: "4 ตัวตรง",
  PERMUTATION_4: "4 ตัวโต๊ด",
  LAST_3_EXACT: "3 ตัวท้ายตรง",
  LAST_3_PERMUTATION: "3 ตัวท้ายโต๊ด",
  FIRST_3_EXACT: "3 ตัวหน้าตรง",
  FIRST_3_PERMUTATION: "3 ตัวหน้าโต๊ด",
  FIRST_2: "2 ตัวหน้า",
  LAST_2: "2 ตัวหลัง",
};

function sameDigits(left: string, right: string): boolean {
  return [...left].sort().join("") === [...right].sort().join("");
}

/**
 * ตรวจเลขชุดหนึ่งรายการกับผล 4–6 หลัก แล้วคืนเฉพาะรางวัลมูลค่าสูงที่สุด
 * ลำดับการตรวจไม่ได้ใช้ตัดสินความใหญ่ แต่เก็บผู้สมัครทั้งหมดแล้ว sort ตามยอดจ่าย
 */
export function laoSetMatchedPrizes(
  numberValue: string,
  resultValue: string,
  packageStake: { toString(): string } | string | number,
): LaoSetWinningPrize[] {
  if (!/^\d{4}$/.test(numberValue) || laoResultProblem(resultValue) !== null) return [];
  const price = laoSetPackagePrice(packageStake);
  const packageRates = LAO_SET_PACKAGE_PAYOUTS.find((item) => item.price === price);
  if (!packageRates) return [];
  const result = laoBreakdown(resultValue);
  const numberLast3 = numberValue.slice(-3);
  const numberFirst3 = numberValue.slice(0, 3);
  const candidates: LaoSetWinningPrize[] = [];
  const add = (condition: boolean, key: LaoSetPrizeKey, payout: number) => {
    if (condition) candidates.push({ key, label: LAO_SET_PRIZE_LABELS[key], payout });
  };
  add(numberValue === result.last4, "EXACT_4", packageRates.exact);
  add(sameDigits(numberValue, result.last4), "PERMUTATION_4", packageRates.permutation);
  add(numberLast3 === result.last3, "LAST_3_EXACT", packageRates.last3Exact);
  add(sameDigits(numberLast3, result.last3), "LAST_3_PERMUTATION", packageRates.last3Permutation);
  add(numberFirst3 === result.first3, "FIRST_3_EXACT", packageRates.first3Exact);
  add(sameDigits(numberFirst3, result.first3), "FIRST_3_PERMUTATION", packageRates.first3Permutation);
  add(numberValue.slice(0, 2) === result.first2, "FIRST_2", packageRates.first2);
  add(numberValue.slice(-2) === result.last2, "LAST_2", packageRates.last2);
  return candidates;
}

export function laoSetWinningPrize(
  numberValue: string,
  resultValue: string,
  packageStake: { toString(): string } | string | number,
): LaoSetWinningPrize | null {
  return [...laoSetMatchedPrizes(numberValue, resultValue, packageStake)]
    .sort((left, right) => right.payout - left.payout)[0] ?? null;
}

export function isSupportedLaoSetPrizeCode(code: number): boolean {
  return LAO_SET_ACTIVE_CODES.some((supported) => supported === code);
}

export const LAO_PRIZE_TYPES: readonly LaoPrizeDefinition[] = [
  { code: 101, name: "3 ตัวตรง", digits: 3, matchRule: "EXACT", lotteryType: "LAO", payoutRate: "650.0000", segment: "LAST3", isActive: true },
  { code: 102, name: "3 ตัวโต๊ด", digits: 3, matchRule: "PERMUTATION", lotteryType: "LAO", payoutRate: "100.0000", segment: "LAST3", isActive: true },
  { code: 103, name: "2 ตัวบน", digits: 2, matchRule: "EXACT", lotteryType: "LAO", payoutRate: "75.0000", segment: "LAST2", isActive: true },
  { code: 104, name: "2 ตัวล่าง", digits: 2, matchRule: "EXACT", lotteryType: "LAO", payoutRate: "75.0000", segment: "FIRST2", isActive: true },
  { code: 201, name: "4 ตัวตรง", digits: 4, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "850.0000", segment: "LAST4", isActive: true },
  { code: 202, name: "3 ตัวท้ายตรง", digits: 3, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "17000.0000", segment: "LAST3", isActive: false },
  { code: 203, name: "4 ตัวโต๊ด", digits: 4, matchRule: "PERMUTATION", lotteryType: "LAO_SET", payoutRate: "37.5000", segment: "LAST4", isActive: false },
  { code: 204, name: "3 ตัวท้ายโต๊ด", digits: 3, matchRule: "PERMUTATION", lotteryType: "LAO_SET", payoutRate: "1250.0000", segment: "LAST3", isActive: false },
  { code: 205, name: "3 ตัวหน้าตรง", digits: 3, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "600.0000", segment: "FIRST3", isActive: false },
  // 2 ตัวล่าง = 2 ตัวหน้าของเลข 4 ตัว · 2 ตัวบน = 2 ตัวท้าย (เดิมชื่อ 2 ตัวหน้า/2 ตัวหลัง)
  { code: 206, name: "2 ตัวล่าง", digits: 2, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "500.0000", segment: "FIRST2", isActive: false },
  { code: 207, name: "2 ตัวบน", digits: 2, matchRule: "EXACT", lotteryType: "LAO_SET", payoutRate: "500.0000", segment: "LAST2", isActive: false },
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

/** เวลามาตรฐานของงวดหวยลาว (เวลาไทย): เปิด 10:00 รับถึง 20:30 ออกผล 20:30 */
export const LAO_DEFAULT_TIMES = { opens: "10:00", cutoff: "20:30", result: "20:30" } as const;

/** หวยลาวออกวันจันทร์–ศุกร์ */
export function isLaoDrawDay(dateText: string): boolean {
  const match = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== dateText) return false;
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

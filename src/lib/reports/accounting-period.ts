/**
 * ช่วงเวลาของหน้าสรุปบัญชี (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล)
 * วันที่ทั้งหมดอิงเวลาไทย และนับจากวันออกผลของงวด
 */

export const ACCOUNTING_QUICK_PERIODS = [
  "all",
  "today", "yesterday", "this_week", "last_week",
  "current_draw", "previous_draw",
  "current_month", "3m", "6m",
  "current_year", "previous_year",
] as const;
export type AccountingQuickPeriod = (typeof ACCOUNTING_QUICK_PERIODS)[number];
export type AccountingPeriodKind = AccountingQuickPeriod | "custom";

export const ACCOUNTING_PERIOD_LABELS: Record<AccountingQuickPeriod, string> = {
  all: "ทั้งหมด",
  today: "วันนี้",
  yesterday: "เมื่อวาน",
  this_week: "สัปดาห์นี้",
  last_week: "สัปดาห์ที่แล้ว",
  current_draw: "งวดนี้",
  previous_draw: "งวดที่แล้ว",
  current_month: "เดือนนี้",
  "3m": "3 เดือน",
  "6m": "6 เดือน",
  current_year: "รายปี",
  previous_year: "ปีที่แล้ว",
};

export const ACCOUNTING_LOTTERIES = ["THAI_GOVERNMENT", "LAO", "LAO_SET"] as const;
export type AccountingLottery = (typeof ACCOUNTING_LOTTERIES)[number];

export type AccountingQuery = {
  period: AccountingPeriodKind;
  /** YYYY-MM-DD สำหรับลิงก์กำหนดช่วงเองเดิม */
  from: string;
  to: string;
  agentId: string;
  /** ประเภทหวยที่นำมาคำนวณ เลือกได้หลายประเภทและเรียงตามลำดับมาตรฐานเสมอ */
  lotteries: AccountingLottery[];
  compareA: AccountingQuickPeriod;
  compareB: AccountingQuickPeriod;
};

export type ResolvedRange = { from: string; to: string; label: string };

type Raw = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** วันที่วันนี้ตามเวลาไทย YYYY-MM-DD */
export function bangkokToday(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isQuickPeriod(value: string): value is AccountingQuickPeriod {
  return (ACCOUNTING_QUICK_PERIODS as readonly string[]).includes(value);
}

export function parseAccountingQuery(raw: Raw, now = new Date()): AccountingQuery {
  const legacyPeriod: Record<string, AccountingPeriodKind> = { draw: "current_draw", month: "current_month", year: "current_year" };
  const requestedPeriod = first(raw.period);
  const period = (isQuickPeriod(requestedPeriod) || requestedPeriod === "custom")
    ? requestedPeriod
    : legacyPeriod[requestedPeriod] ?? "current_draw";
  const legacyLottery = first(raw.lottery);
  const lotteriesParam = first(raw.lotteries);
  const requestedLotteries = lotteriesParam === "none"
    ? []
    : lotteriesParam
      ? lotteriesParam.split(",")
      : (ACCOUNTING_LOTTERIES as readonly string[]).includes(legacyLottery)
        ? [legacyLottery]
        : [...ACCOUNTING_LOTTERIES];
  const lotteries = ACCOUNTING_LOTTERIES.filter((lottery) => requestedLotteries.includes(lottery));
  const compareA = first(raw.compareA);
  const compareB = first(raw.compareB);
  return {
    period,
    from: isDate(first(raw.from)) ? first(raw.from) : "",
    to: isDate(first(raw.to)) ? first(raw.to) : "",
    agentId: first(raw.agentId).slice(0, 64),
    lotteries,
    compareA: isQuickPeriod(compareA) ? compareA : "current_draw",
    compareB: isQuickPeriod(compareB) ? compareB : "previous_draw",
  };
}

const MONTH = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const utc = (value: string) => new Date(`${value}T00:00:00Z`);

function shiftDays(value: string, days: number): string {
  const date = utc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function monthsBack(today: string, count: number): string {
  const [year, month] = today.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1 - count, 1)).toISOString().slice(0, 10);
}

function mondayOf(value: string): string {
  const date = utc(value);
  const day = date.getUTCDay() || 7;
  return shiftDays(value, 1 - day);
}

/** ช่วงวันที่ของช่วงเวลาที่เลือก (งวดนี้/งวดที่แล้วจะหา draw id ใน service) */
export function resolveRange(query: AccountingQuery, now = new Date()): ResolvedRange {
  const today = bangkokToday(now);
  switch (query.period) {
    case "all":
      return { from: "", to: "", label: "ข้อมูลทั้งหมด" };
    case "today":
      return { from: today, to: today, label: `วันนี้ (${DAY.format(utc(today))})` };
    case "yesterday": {
      const day = shiftDays(today, -1);
      return { from: day, to: day, label: `เมื่อวาน (${DAY.format(utc(day))})` };
    }
    case "this_week": {
      const from = mondayOf(today);
      return { from, to: today, label: `สัปดาห์นี้ (${DAY.format(utc(from))} – ${DAY.format(utc(today))})` };
    }
    case "last_week": {
      const to = shiftDays(mondayOf(today), -1);
      const from = shiftDays(to, -6);
      return { from, to, label: `สัปดาห์ที่แล้ว (${DAY.format(utc(from))} – ${DAY.format(utc(to))})` };
    }
    case "current_month": {
      const from = `${today.slice(0, 7)}-01`;
      return { from, to: today, label: `เดือน${MONTH.format(utc(from))}` };
    }
    case "3m":
    case "6m": {
      const months = query.period === "3m" ? 3 : 6;
      const from = monthsBack(today, months - 1);
      return { from, to: today, label: `${months} เดือนล่าสุด (${DAY.format(utc(from))} – ${DAY.format(utc(today))})` };
    }
    case "current_year":
      return { from: `${today.slice(0, 4)}-01-01`, to: today, label: `ปี ${Number(today.slice(0, 4)) + 543}` };
    case "previous_year": {
      const year = Number(today.slice(0, 4)) - 1;
      return { from: `${year}-01-01`, to: `${year}-12-31`, label: `ปีที่แล้ว (${year + 543})` };
    }
    case "custom": {
      const from = query.from || `${today.slice(0, 7)}-01`;
      const to = query.to && query.to >= from ? query.to : today;
      return { from, to, label: `${DAY.format(utc(from))} – ${DAY.format(utc(to))}` };
    }
    case "current_draw":
      return { from: "", to: "", label: ACCOUNTING_PERIOD_LABELS.current_draw };
    case "previous_draw":
      return { from: "", to: "", label: ACCOUNTING_PERIOD_LABELS.previous_draw };
  }
}

/** ลิงก์ของหน้าสรุปบัญชี เปลี่ยนบางค่าแล้วคงค่าอื่นไว้ */
export function accountingHref(base: string, query: AccountingQuery, change: Partial<AccountingQuery>): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  params.set("period", next.period);
  if (next.period === "custom") {
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
  }
  if (next.agentId) params.set("agentId", next.agentId);
  if (next.lotteries.length === 0) params.set("lotteries", "none");
  else if (next.lotteries.length !== ACCOUNTING_LOTTERIES.length) params.set("lotteries", next.lotteries.join(","));
  if (next.compareA !== "current_draw") params.set("compareA", next.compareA);
  if (next.compareB !== "previous_draw") params.set("compareB", next.compareB);
  return `${base}?${params}`;
}

/** ชื่อประเภทหวยที่เลือกสำหรับหัวรายงานและไฟล์ส่งออก */
export function accountingLotterySelectionLabel(lotteries: readonly AccountingLottery[]): string {
  if (lotteries.length === ACCOUNTING_LOTTERIES.length) return "ทุกประเภท";
  if (lotteries.length === 0) return "ยังไม่ได้เลือกประเภทหวย";
  const labels: Record<AccountingLottery, string> = {
    THAI_GOVERNMENT: "หวยรัฐบาล",
    LAO: "หวยลาว",
    LAO_SET: "หวยลาวชุด",
  };
  return lotteries.map((lottery) => labels[lottery]).join(" + ");
}

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
  current_year: "ปีนี้",
  previous_year: "ปีที่แล้ว",
};

export const ACCOUNTING_LOTTERIES = ["THAI_GOVERNMENT", "LAO", "LAO_SET"] as const;
export type AccountingLottery = (typeof ACCOUNTING_LOTTERIES)[number];

export function normalizeAccountingLotteries(requested: readonly string[]): AccountingLottery[] {
  const thai = requested.includes("THAI_GOVERNMENT");
  const lao = requested.includes("LAO") || requested.includes("LAO_SET");
  if ((!thai && !lao) || (thai && lao)) return [...ACCOUNTING_LOTTERIES];
  return thai ? ["THAI_GOVERNMENT"] : ["LAO", "LAO_SET"];
}

export type AccountingQuery = {
  period: AccountingPeriodKind;
  /** YYYY-MM-DD สำหรับลิงก์กำหนดช่วงเองเดิม */
  from: string;
  to: string;
  agentId: string;
  /** Agent ของแต่ละฝั่งในการเปรียบเทียบแบบเลือกเอง (ค่าว่าง = ทุก Agent) */
  compareAgentA: string;
  compareAgentB: string;
  /** ประเภทหวยที่นำมาคำนวณ เลือกได้หลายประเภทและเรียงตามลำดับมาตรฐานเสมอ */
  lotteries: AccountingLottery[];
  /**
   * การเปรียบเทียบ
   * - none: ไม่เทียบ
   * - previous: เทียบกับช่วงก่อนหน้าแบบเดียวกัน (ระบบเลือกช่วงให้)
   * - custom: เลือกเองทั้งสองฝั่ง โดยเลือกหน่วยก่อน (วัน/งวด/สัปดาห์/เดือน) แล้ว A กับ B เป็นหน่วยเดียวกันเสมอ
   */
  compare: AccountingCompareMode;
  compareUnit: CompareUnit;
  /** ประเภทหวยของแต่ละฝั่งในการเปรียบเทียบแบบเลือกเอง */
  compareLotteryA: AccountingCompareCategory;
  compareLotteryB: AccountingCompareCategory;
  /**
   * ค่าของช่วง A/B ตามหน่วย
   * วัน: YYYY-MM-DD · สัปดาห์: วันจันทร์ YYYY-MM-DD · เดือน: YYYY-MM · งวด: id ของงวด ("" = ให้หน้าเลือกงวดล่าสุด)
   */
  compareA: string;
  compareB: string;
  /** ช่วงวันที่อิสระของแต่ละฝั่ง เมื่อ compareUnit = range */
  compareAFrom: string;
  compareATo: string;
  compareBFrom: string;
  compareBTo: string;
  /** ใช้ภายใน: ดูเฉพาะงวดเหล่านี้ (เปรียบเทียบรายงวด) */
  drawIds?: string[];
};

export type AccountingCompareMode = "none" | "previous" | "custom";
export type AccountingCompareCategory = "THAI_GOVERNMENT" | "LAO_COMBINED";
export type DateSpan = { from: string; to: string };

export const COMPARE_UNITS = ["day", "draw", "week", "month", "range"] as const;
export type CompareUnit = (typeof COMPARE_UNITS)[number];
export const COMPARE_UNIT_LABEL: Record<CompareUnit, string> = { day: "วัน", draw: "งวด", week: "สัปดาห์", month: "เดือน", range: "ช่วงวันที่" };

/** ช่วงที่แสดงเป็นชิปหลักของหน้าสรุปบัญชี ที่เหลืออยู่ในเมนู "ช่วงอื่น" */
export const ACCOUNTING_MAIN_PERIODS: readonly AccountingPeriodKind[] = ["current_draw", "current_month", "current_year", "custom"];

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
    : legacyPeriod[requestedPeriod] ?? "all";
  const legacyLottery = first(raw.lottery);
  const lotteriesParam = first(raw.lotteries);
  const requestedLotteries = lotteriesParam === "none"
    ? []
    : lotteriesParam
      ? lotteriesParam.split(",")
      : (ACCOUNTING_LOTTERIES as readonly string[]).includes(legacyLottery)
        ? [legacyLottery]
        : [...ACCOUNTING_LOTTERIES];
  const lotteries = lotteriesParam === "none" ? [] : normalizeAccountingLotteries(requestedLotteries);
  const compareRaw = first(raw.compare);
  const compare: AccountingCompareMode = compareRaw === "custom" ? "custom" : compareRaw === "1" || compareRaw === "previous" ? "previous" : "none";
  const unitRaw = first(raw.unit);
  const compareUnit: CompareUnit = (COMPARE_UNITS as readonly string[]).includes(unitRaw) ? unitRaw as CompareUnit : "month";
  const defaults = defaultCompareValues(compareUnit, now);
  const rangeDefaults = defaultCompareRanges(now);
  const value = (key: string, fallback: string) => {
    const raw_ = first(raw[key]);
    return isCompareValue(compareUnit, raw_) ? (compareUnit === "week" ? mondayOf(raw_) : raw_) : fallback;
  };
  const query: AccountingQuery = {
    period,
    from: isDate(first(raw.from)) ? first(raw.from) : "",
    to: isDate(first(raw.to)) ? first(raw.to) : "",
    agentId: first(raw.agentId).slice(0, 64),
    compareAgentA: first(raw.agentA).slice(0, 64),
    compareAgentB: first(raw.agentB).slice(0, 64),
    lotteries,
    compare,
    compareUnit,
    compareLotteryA: parseCompareCategory(first(raw.lotteryA), "THAI_GOVERNMENT"),
    compareLotteryB: parseCompareCategory(first(raw.lotteryB), "LAO_COMBINED"),
    compareA: value("a", defaults.a),
    compareB: value("b", defaults.b),
    compareAFrom: isDate(first(raw.aFrom)) ? first(raw.aFrom) : rangeDefaults.a.from,
    compareATo: isDate(first(raw.aTo)) && first(raw.aTo) >= first(raw.aFrom) ? first(raw.aTo) : rangeDefaults.a.to,
    compareBFrom: isDate(first(raw.bFrom)) ? first(raw.bFrom) : rangeDefaults.b.from,
    compareBTo: isDate(first(raw.bTo)) && first(raw.bTo) >= first(raw.bFrom) ? first(raw.bTo) : rangeDefaults.b.to,
    // ส่งออกของงวดเดียว (มาจากการเทียบรายงวด)
    ...(/^[A-Za-z0-9_-]{8,64}$/.test(first(raw.draw)) ? { drawIds: [first(raw.draw)] } : first(raw.draw) === "none" ? { drawIds: [] } : {}),
  };
  // ช่วงที่เทียบกับช่วงก่อนไม่ได้ (ทั้งหมด/ปีที่แล้ว/งวดที่แล้ว) ถือว่าไม่เทียบ ไม่ค้างโหมดเทียบไว้ในลิงก์
  if (query.compare === "previous" && !previousPeriodQuery(query, now)) query.compare = "none";
  return query;
}

function parseCompareCategory(value: string, fallback: AccountingCompareCategory): AccountingCompareCategory {
  if (value === "LAO_COMBINED" || value === "LAO" || value === "LAO_SET") return "LAO_COMBINED";
  if (value === "THAI_GOVERNMENT") return "THAI_GOVERNMENT";
  return fallback;
}

function isCompareValue(unit: CompareUnit, value: string): boolean {
  if (unit === "range") return false;
  if (unit === "month") return value === "all" || /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  if (unit === "draw") return /^[A-Za-z0-9_-]{8,64}$/.test(value);
  return isDate(value);
}

function defaultCompareRanges(now = new Date()): { a: DateSpan; b: DateSpan } {
  const today = bangkokToday(now);
  const [year, month, day] = today.split("-").map(Number);
  const previousStart = new Date(Date.UTC(year!, month! - 2, 1));
  const previousLastDay = new Date(Date.UTC(year!, month! - 1, 0)).getUTCDate();
  return {
    a: { from: `${today.slice(0, 7)}-01`, to: today },
    b: {
      from: previousStart.toISOString().slice(0, 10),
      to: new Date(Date.UTC(year!, month! - 2, Math.min(day!, previousLastDay))).toISOString().slice(0, 10),
    },
  };
}

/** ค่าเริ่มต้นเมื่อเลือกหน่วย: ช่วงล่าสุด (A) เทียบกับช่วงก่อนหน้า (B) งวดให้หน้าเลือกจากรายการงวด */
export function defaultCompareValues(unit: CompareUnit, now = new Date()): { a: string; b: string } {
  const today = bangkokToday(now);
  switch (unit) {
    case "day":
      return { a: today, b: shiftDays(today, -1) };
    case "week": {
      const monday = mondayOf(today);
      return { a: monday, b: shiftDays(monday, -7) };
    }
    case "month": {
      const [year, month] = today.split("-").map(Number);
      return { a: today.slice(0, 7), b: new Date(Date.UTC(year!, month! - 2, 1)).toISOString().slice(0, 7) };
    }
    case "draw":
    case "range":
      return { a: "", b: "" };
  }
}

/** ช่วงวันที่ของค่าในหน่วยวัน/สัปดาห์/เดือน */
export function compareSpan(unit: Exclude<CompareUnit, "draw">, value: string): DateSpan {
  if (unit === "day") return { from: value, to: value };
  if (unit === "week") return { from: value, to: shiftDays(value, 6) };
  return monthSpan(value);
}

/** ชื่อของค่าในหน่วยวัน/สัปดาห์/เดือน เช่น "19 พ.ย. 2569" · "สัปดาห์ 16 – 22 พ.ย. 2569" · "มีนาคม 2569" */
export function compareValueLabel(unit: Exclude<CompareUnit, "draw">, value: string): string {
  if (unit === "day") return DAY.format(utc(value));
  if (unit === "week") return `สัปดาห์ ${DAY.format(utc(value))} – ${DAY.format(utc(shiftDays(value, 6)))}`;
  return MONTH.format(utc(`${value}-01`));
}

const WEEKDAY = new Intl.DateTimeFormat("th-TH", { weekday: "short", timeZone: "UTC" });

/** รายการวันให้เลือก (ล่าสุดก่อน) เป็นวันที่แบบไทย ไม่ขึ้นกับรูปแบบวันที่ของเบราว์เซอร์ */
export function recentDays(count: number, now = new Date()): { value: string; label: string }[] {
  const today = bangkokToday(now);
  return Array.from({ length: count }, (_, index) => {
    const value = shiftDays(today, -index);
    const label = `${WEEKDAY.format(utc(value))} ${DAY.format(utc(value))}`;
    return { value, label: index === 0 ? `วันนี้ (${label})` : index === 1 ? `เมื่อวาน (${label})` : label };
  });
}

/** รายการสัปดาห์ให้เลือก (ล่าสุดก่อน) value = วันจันทร์ */
export function recentWeeks(count: number, now = new Date()): { value: string; label: string }[] {
  const monday = mondayOf(bangkokToday(now));
  return Array.from({ length: count }, (_, index) => {
    const value = shiftDays(monday, -7 * index);
    const label = compareValueLabel("week", value).replace(/^สัปดาห์ /, "");
    return { value, label: index === 0 ? `สัปดาห์นี้ (${label})` : index === 1 ? `สัปดาห์ที่แล้ว (${label})` : label };
  });
}

/** ช่วงเดือนเต็ม (YYYY-MM) → วันแรกถึงวันสุดท้ายของเดือน */
export function monthSpan(month: string): DateSpan {
  const [year, value] = month.split("-").map(Number);
  return {
    from: `${month}-01`,
    to: new Date(Date.UTC(year!, value!, 0)).toISOString().slice(0, 10),
  };
}

/** รายการเดือนให้เลือก (ล่าสุดก่อน) เช่น { value: "2026-11", label: "พฤศจิกายน 2569" } */
export function recentMonths(count: number, now = new Date()): { value: string; label: string }[] {
  const today = bangkokToday(now);
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year!, month! - 1 - index, 1));
    return { value: date.toISOString().slice(0, 7), label: MONTH.format(date) };
  });
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
  // งวดที่ระบุ (ส่งออกของการเทียบรายงวด) "none" = ไม่มีงวดให้ดู ส่งออกจึงว่างตรงกับหน้าจอ
  if (next.drawIds) params.set("draw", next.drawIds[0] ?? "none");
  if (next.compare === "previous") params.set("compare", "previous");
  if (next.compare === "custom") {
    params.set("compare", "custom");
    params.set("unit", next.compareUnit);
    if (next.compareA) params.set("a", next.compareA);
    if (next.compareB) params.set("b", next.compareB);
    params.set("lotteryA", next.compareLotteryA);
    params.set("lotteryB", next.compareLotteryB);
    if (next.compareAgentA) params.set("agentA", next.compareAgentA);
    if (next.compareAgentB) params.set("agentB", next.compareAgentB);
    if (next.compareUnit === "range") {
      params.set("aFrom", next.compareAFrom);
      params.set("aTo", next.compareATo);
      params.set("bFrom", next.compareBFrom);
      params.set("bTo", next.compareBTo);
    }
  }
  return `${base}?${params}`;
}

/**
 * ช่วงก่อนหน้าแบบเดียวกัน สำหรับสวิตช์ "เทียบกับช่วงก่อนหน้า"
 * - งวดนี้ → งวดที่แล้ว · วันนี้ → เมื่อวาน · สัปดาห์นี้ → สัปดาห์ที่แล้ว
 * - เดือนนี้ → เดือนก่อนถึงวันที่เดียวกัน · ปีนี้ → ปีก่อนถึงวันเดียวกัน (เทียบช่วงเวลาที่ยาวเท่ากัน)
 * - ช่วงอื่น → ช่วงยาวเท่ากันที่อยู่ก่อนหน้าทันที
 * null = เทียบไม่ได้ (ข้อมูลทั้งหมด / งวดที่แล้ว / ปีที่แล้ว)
 */
export function previousPeriodQuery(query: AccountingQuery, now = new Date()): AccountingQuery | null {
  const base = { ...query, compare: "none" as const };
  switch (query.period) {
    case "all":
    case "previous_draw":
      return null;
    case "current_draw":
      return { ...base, period: "previous_draw" };
    case "today":
      return { ...base, period: "yesterday" };
    case "this_week":
      return { ...base, period: "last_week" };
    case "current_year": {
      const today = bangkokToday(now);
      const year = Number(today.slice(0, 4)) - 1;
      const to = `${year}${today.slice(4)}` === `${year}-02-29` ? `${year}-02-28` : `${year}${today.slice(4)}`;
      return { ...base, period: "custom", from: `${year}-01-01`, to };
    }
    case "current_month": {
      const today = bangkokToday(now);
      const [year, month, day] = today.split("-").map(Number);
      const start = new Date(Date.UTC(year!, month! - 2, 1));
      const lastDay = new Date(Date.UTC(year!, month! - 1, 0)).getUTCDate();
      const from = start.toISOString().slice(0, 10);
      const to = new Date(Date.UTC(year!, month! - 2, Math.min(day!, lastDay))).toISOString().slice(0, 10);
      return { ...base, period: "custom", from, to };
    }
    default: {
      // วันเดียว/สัปดาห์ที่แล้ว/3–6 เดือน/ปีที่แล้ว/กำหนดเอง: ช่วงยาวเท่ากันก่อนหน้าทันที
      if (query.period === "previous_year") return null;
      const range = resolveRange(query, now);
      if (!range.from || !range.to) return null;
      const length = Math.round((utc(range.to).getTime() - utc(range.from).getTime()) / 86_400_000) + 1;
      const to = shiftDays(range.from, -1);
      return { ...base, period: "custom", from: shiftDays(to, -(length - 1)), to };
    }
  }
}

/**
 * ช่วง A/B ของการเลือกเอง แปลงเป็น query ของรายงาน โดยแต่ละฝั่งเลือก Agent ได้อิสระ
 * รายงวด: เลือก id เพื่อดูงวดเดียว หรือเว้นว่างเพื่อรวมทุกงวดของประเภทหวยฝั่งนั้น
 * วัน/สัปดาห์/เดือน: ใช้ตัวกรองประเภทหวยเดียวกับหน้า
 */
export function customCompareQueries(query: AccountingQuery, drawA: string, drawB: string): [AccountingQuery, AccountingQuery] {
  const base = { ...query, compare: "none" as const, period: "custom" as const };
  const sideA = { ...base, agentId: query.compareAgentA };
  const sideB = { ...base, agentId: query.compareAgentB };
  const lotteries = (category: AccountingCompareCategory): AccountingLottery[] => category === "THAI_GOVERNMENT"
    ? ["THAI_GOVERNMENT"]
    : ["LAO", "LAO_SET"];
  if (query.compareUnit === "draw") {
    return [
      { ...sideA, period: drawA ? "custom" : "all", lotteries: lotteries(query.compareLotteryA), drawIds: drawA ? [drawA] : undefined },
      { ...sideB, period: drawB ? "custom" : "all", lotteries: lotteries(query.compareLotteryB), drawIds: drawB ? [drawB] : undefined },
    ];
  }
  if (query.compareUnit === "range") {
    return [
      { ...sideA, lotteries: lotteries(query.compareLotteryA), from: query.compareAFrom, to: query.compareATo, drawIds: undefined },
      { ...sideB, lotteries: lotteries(query.compareLotteryB), from: query.compareBFrom, to: query.compareBTo, drawIds: undefined },
    ];
  }
  const unit = query.compareUnit;
  if (unit === "month" && (query.compareA === "all" || query.compareB === "all")) {
    const monthQuery = (side: AccountingQuery, value: string, category: AccountingCompareCategory): AccountingQuery => value === "all"
      ? { ...side, period: "all", lotteries: lotteries(category), drawIds: undefined }
      : { ...side, lotteries: lotteries(category), ...compareSpan("month", value), drawIds: undefined };
    return [monthQuery(sideA, query.compareA, query.compareLotteryA), monthQuery(sideB, query.compareB, query.compareLotteryB)];
  }
  const a = compareSpan(unit, query.compareA);
  const b = compareSpan(unit, query.compareB);
  return [
    { ...sideA, lotteries: lotteries(query.compareLotteryA), ...a, drawIds: undefined },
    { ...sideB, lotteries: lotteries(query.compareLotteryB), ...b, drawIds: undefined },
  ];
}

/** ชื่อเรียกช่วงก่อนหน้าแบบภาษาพูด ตามช่วงที่ดูอยู่ */
const PREVIOUS_NAME: Partial<Record<AccountingPeriodKind, string>> = {
  current_draw: "งวดที่แล้ว",
  today: "เมื่อวาน",
  this_week: "สัปดาห์ที่แล้ว",
  current_month: "เดือนที่แล้ว",
  current_year: "ปีที่แล้ว",
};

const dateSpan = (range: { from: string; to: string }) =>
  range.from === range.to ? DAY.format(utc(range.from)) : `${DAY.format(utc(range.from))} – ${DAY.format(utc(range.to))}`;

/**
 * ข้อความของปุ่มเปรียบเทียบ ให้รู้ชัดว่าเทียบอะไรกับอะไร
 * button: "เทียบกับปีที่แล้ว" · current/previous: ช่วงวันที่จริงของทั้งสองฝั่ง
 * null = ช่วงนี้เทียบไม่ได้
 */
export function comparisonText(query: AccountingQuery, now = new Date()): { button: string; current: string; previous: string } | null {
  const previous = previousPeriodQuery(query, now);
  if (!previous) return null;
  const name = PREVIOUS_NAME[query.period] ?? "ช่วงก่อนหน้าที่ยาวเท่ากัน";
  if (previous.period === "previous_draw") {
    return { button: `เทียบกับ${name}`, current: "งวดล่าสุดของแต่ละประเภทหวย", previous: "งวดก่อนหน้าของแต่ละประเภทหวย" };
  }
  return { button: `เทียบกับ${name}`, current: dateSpan(resolveRange(query, now)), previous: dateSpan(resolveRange(previous, now)) };
}

/** ชื่อช่วงเปรียบเทียบสำหรับหัวตารางและประโยคสรุป เช่น "ปีที่แล้ว (1 ม.ค. 2568 – 18 พ.ย. 2568)" */
export function previousPeriodLabel(query: AccountingQuery, now = new Date()): string {
  const text = comparisonText(query, now);
  if (!text) return "";
  const name = PREVIOUS_NAME[query.period] ?? "ช่วงก่อนหน้า";
  return query.period === "current_draw" ? name : `${name} (${text.previous})`;
}

/** ชื่อประเภทหวยที่เลือกสำหรับหัวรายงานและไฟล์ส่งออก */
export function accountingLotterySelectionLabel(lotteries: readonly AccountingLottery[]): string {
  if (lotteries.length === ACCOUNTING_LOTTERIES.length) return "ทุกประเภท";
  if (lotteries.length === 0) return "ยังไม่ได้เลือกประเภทหวย";
  return lotteries.includes("THAI_GOVERNMENT") ? "หวยรัฐบาล" : "หวยลาวและหวยลาวชุด";
}

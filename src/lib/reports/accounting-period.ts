/**
 * ช่วงเวลาของหน้าสรุปบัญชี (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล)
 *
 * ดูได้ทีละงวด รายเดือน 3 เดือน 6 เดือน รายปี หรือกำหนดช่วงเอง
 * ช่วงวันที่นับตาม "วันออกผลของงวด" ตามเวลาไทย
 */

export type AccountingPeriodKind = "draw" | "month" | "3m" | "6m" | "year" | "custom";
export const ACCOUNTING_LOTTERIES = ["THAI_GOVERNMENT", "LAO", "LAO_SET"] as const;
export type AccountingLottery = (typeof ACCOUNTING_LOTTERIES)[number];

export type AccountingQuery = {
  period: AccountingPeriodKind;
  /** YYYY-MM สำหรับรายเดือน */
  month: string;
  /** YYYY สำหรับรายปี */
  year: string;
  /** YYYY-MM-DD สำหรับกำหนดเอง */
  from: string;
  to: string;
  drawId: string;
  agentId: string;
  lottery: AccountingLottery | "";
};

export type ResolvedRange = { from: string; to: string; label: string };

type Raw = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
const PERIODS: readonly AccountingPeriodKind[] = ["draw", "month", "3m", "6m", "year", "custom"];

/** วันที่วันนี้ตามเวลาไทย YYYY-MM-DD */
export function bangkokToday(now: Date): string {
  return new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseAccountingQuery(raw: Raw, now = new Date()): AccountingQuery {
  const today = bangkokToday(now);
  const period = first(raw.period);
  const month = first(raw.month);
  const year = first(raw.year);
  const lottery = first(raw.lottery);
  return {
    period: (PERIODS as readonly string[]).includes(period) ? (period as AccountingPeriodKind) : "month",
    month: /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : today.slice(0, 7),
    year: /^\d{4}$/.test(year) ? year : today.slice(0, 4),
    from: isDate(first(raw.from)) ? first(raw.from) : "",
    to: isDate(first(raw.to)) ? first(raw.to) : "",
    drawId: first(raw.drawId).slice(0, 64),
    agentId: first(raw.agentId).slice(0, 64),
    lottery: (ACCOUNTING_LOTTERIES as readonly string[]).includes(lottery) ? (lottery as AccountingLottery) : "",
  };
}

const MONTH = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "UTC" });
const DAY = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const utc = (value: string) => new Date(`${value}T00:00:00Z`);

function lastDayOfMonth(month: string): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year!, monthIndex!, 0)).toISOString().slice(0, 10);
}

function monthsBack(today: string, count: number): string {
  const [year, month] = today.split("-").map(Number);
  // month เป็นเลขเดือน 1–12 แต่ Date.UTC ใช้ 0–11
  return new Date(Date.UTC(year!, month! - 1 - count, 1)).toISOString().slice(0, 10);
}

/** ช่วงวันที่ของช่วงเวลาที่เลือก (ไม่ใช้กับรายงวด) */
export function resolveRange(query: AccountingQuery, now = new Date()): ResolvedRange {
  const today = bangkokToday(now);
  switch (query.period) {
    case "month": {
      const from = `${query.month}-01`;
      return { from, to: lastDayOfMonth(query.month), label: `เดือน${MONTH.format(utc(from))}` };
    }
    case "3m":
    case "6m": {
      const months = query.period === "3m" ? 3 : 6;
      const from = monthsBack(today, months - 1);
      return { from, to: lastDayOfMonth(today.slice(0, 7)), label: `${months} เดือนล่าสุด (${DAY.format(utc(from))} – ${DAY.format(utc(lastDayOfMonth(today.slice(0, 7))))})` };
    }
    case "year":
      return { from: `${query.year}-01-01`, to: `${query.year}-12-31`, label: `ปี ${Number(query.year) + 543}` };
    case "custom": {
      const from = query.from || `${today.slice(0, 7)}-01`;
      const to = query.to && query.to >= from ? query.to : today;
      return { from, to, label: `${DAY.format(utc(from))} – ${DAY.format(utc(to))}` };
    }
    case "draw":
      return { from: "", to: "", label: "รายงวด" };
  }
}

/** ลิงก์ของหน้าสรุปบัญชี เปลี่ยนบางค่าแล้วคงค่าอื่นไว้ */
export function accountingHref(base: string, query: AccountingQuery, change: Partial<AccountingQuery>): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  params.set("period", next.period);
  if (next.period === "month") params.set("month", next.month);
  if (next.period === "year") params.set("year", next.year);
  if (next.period === "custom") {
    if (next.from) params.set("from", next.from);
    if (next.to) params.set("to", next.to);
  }
  if (next.period === "draw" && next.drawId) params.set("drawId", next.drawId);
  if (next.agentId) params.set("agentId", next.agentId);
  if (next.lottery) params.set("lottery", next.lottery);
  return `${base}?${params}`;
}

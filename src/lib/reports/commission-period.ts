import { parseDay } from "@/lib/draws/range";

const DATE_KEY = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" });
const THAI_DAY = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
const THAI_MONTH = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" });

export type CommissionPeriod = { mode: "all" | "range" | "month"; value?: string; from?: string; to?: string; label: string };

/** แปลงตัวกรองปฏิทินเป็นค่า canonical โดยไม่ยอมรับวันที่คลุมเครือ */
export function resolveCommissionPeriod(query: { period?: string; date?: string; dateFrom?: string; dateTo?: string }): CommissionPeriod {
  if (query.period === "day" && /^\d{4}-\d{2}-\d{2}$/.test(query.date ?? "")) {
    const parsed = new Date(`${query.date}T00:00:00+07:00`);
    if (!Number.isNaN(parsed.getTime()) && DATE_KEY.format(parsed) === query.date) {
      return { mode: "range", from: query.date, to: query.date, label: `วันที่ ${THAI_DAY.format(parsed)}` };
    }
  }
  if (query.period === "range") {
    const from = parseDay(query.dateFrom);
    const to = parseDay(query.dateTo);
    if ((from || to) && (!from || !to || from <= to)) {
      const fromLabel = from ? THAI_DAY.format(new Date(`${from}T00:00:00+07:00`)) : "เริ่มต้น";
      const toLabel = to ? THAI_DAY.format(new Date(`${to}T00:00:00+07:00`)) : "ล่าสุด";
      return { mode: "range", from, to, label: from === to ? `วันที่ ${fromLabel}` : `ตั้งแต่ ${fromLabel} ถึง ${toLabel}` };
    }
  }
  if (query.period === "month" && /^\d{4}-\d{2}$/.test(query.date ?? "")) {
    const parsed = new Date(`${query.date}-01T00:00:00+07:00`);
    if (!Number.isNaN(parsed.getTime()) && DATE_KEY.format(parsed).slice(0, 7) === query.date) {
      return { mode: "month", value: query.date, label: `เดือน${THAI_MONTH.format(parsed)}` };
    }
  }
  return { mode: "all", label: "ทุกวัน" };
}

export function commissionDrawDateKey(value: Date): string {
  return DATE_KEY.format(value);
}

export function currentCommissionMonth(now = new Date()): string {
  return commissionDrawDateKey(now).slice(0, 7);
}

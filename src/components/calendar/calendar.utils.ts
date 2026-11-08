const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;

export function parseISODate(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export function toISODate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function parseISODateTime(value: string): { date: string; time: string } | null {
  const match = ISO_DATE_TIME.exec(value);
  if (!match || !parseISODate(match[1]!)) return null;
  const hour = Number(match[2]);
  const minute = Number(match[3]);
  if (hour > 23 || minute > 59) return null;
  return { date: match[1]!, time: `${match[2]}:${match[3]}` };
}

export function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export function addDays(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + amount));
}

export function addMonths(date: Date, amount: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

export function calendarDays(viewMonth: Date): Date[] {
  const first = startOfMonth(viewMonth);
  const gridStart = addDays(first, -first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function isDateDisabled(value: string, minDate?: string, maxDate?: string, disabledDate?: (date: string) => boolean): boolean {
  if (!parseISODate(value)) return true;
  if (minDate && value < minDate) return true;
  if (maxDate && value > maxDate) return true;
  return disabledDate?.(value) ?? false;
}

export function isDateInRange(value: string, startDate: string, endDate: string): boolean {
  return Boolean(startDate && endDate && value > startDate && value < endDate);
}

export function todayInTimeZone(timeZone = "Asia/Bangkok", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function timeInTimeZone(timeZone = "Asia/Bangkok", now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("hour")}:${value("minute")}`;
}

export function formatDate(value: string, locale = "th-TH"): string {
  const date = parseISODate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

export function formatDateTime(value: string, locale = "th-TH"): string {
  const parsed = parseISODateTime(value);
  if (!parsed) return "";
  return `${formatDate(parsed.date, locale)} · ${parsed.time} น.`;
}


const THAI_DRAW_DATE = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const BANGKOK_UTC_OFFSET_HOURS = 7;
const OFFICIAL_CUTOFF_HOUR = 15;

export function toBangkokDateTimeLocal(date: Date): string {
  const bangkok = new Date(date.getTime() + BANGKOK_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return `${bangkok.getUTCFullYear()}-${String(bangkok.getUTCMonth() + 1).padStart(2, "0")}-${String(bangkok.getUTCDate()).padStart(2, "0")}T${String(bangkok.getUTCHours()).padStart(2, "0")}:${String(bangkok.getUTCMinutes()).padStart(2, "0")}`;
}

export function parseBangkokDateTimeLocal(raw: string): Date | null {
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) return null;

  const value = new Date(Date.UTC(year, month, day, hour - BANGKOK_UTC_OFFSET_HOURS, minute));
  return toBangkokDateTimeLocal(value) === raw ? value : null;
}

function parseDatePart(raw: string): { year: number; month: number; day: number } | null {
  const datePart = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!datePart) return null;

  const [, yearText, monthText, dayText] = datePart;
  const year = Number(yearText);
  const month = Number(monthText) - 1;
  const day = Number(dayText);
  const selected = new Date(Date.UTC(year, month, day));
  if (
    selected.getUTCFullYear() !== year
    || selected.getUTCMonth() !== month
    || selected.getUTCDate() !== day
  ) return null;

  return { year, month, day };
}

export function nextOfficialDrawDate(raw: string): Date | null {
  const date = parseDatePart(raw);
  if (!date) return null;
  const { year, month, day } = date;
  const selected = new Date(Date.UTC(year, month, day));

  if (day === 1) return selected;
  if (day <= 16) return new Date(Date.UTC(year, month, 16));
  return new Date(Date.UTC(year, month + 1, 1));
}

export function officialDrawName(raw: string): string | null {
  const date = nextOfficialDrawDate(raw);
  return date ? THAI_DRAW_DATE.format(date) : null;
}

/** เวลาปิดรับมาตรฐานของงวด 1/16 คือ 15:00 น. ตามเวลาไทย */
export function officialDrawCutoffAt(raw: string): Date | null {
  const date = parseDatePart(raw);
  if (!date || (date.day !== 1 && date.day !== 16)) return null;

  return new Date(Date.UTC(
    date.year,
    date.month,
    date.day,
    OFFICIAL_CUTOFF_HOUR - BANGKOK_UTC_OFFSET_HOURS,
  ));
}

/** ค่าเริ่มต้นของช่วงรับบิล: เปิดก่อนวันงวด 5 วัน และปิดก่อนวันงวด 1 วัน เวลา 14:00 น. */
export function defaultOfficialDrawWindow(raw: string): { opensAt: Date; cutoffAt: Date } | null {
  const date = parseDatePart(raw);
  if (!date || (date.day !== 1 && date.day !== 16)) return null;

  return {
    opensAt: new Date(Date.UTC(
      date.year,
      date.month,
      date.day - 5,
      -BANGKOK_UTC_OFFSET_HOURS,
    )),
    cutoffAt: new Date(Date.UTC(
      date.year,
      date.month,
      date.day - 1,
      14 - BANGKOK_UTC_OFFSET_HOURS,
    )),
  };
}

/** สร้างรายการงวดอนาคต โดยคืนเฉพาะวันที่ 1 และ 16 ที่ยังไม่ปิดรับ */
export function upcomingOfficialDrawDates(now: Date, count = 12): string[] {
  const bangkokNow = new Date(now.getTime() + BANGKOK_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  const year = bangkokNow.getUTCFullYear();
  const month = bangkokNow.getUTCMonth();
  const dates: string[] = [];

  for (let monthOffset = 0; dates.length < count && monthOffset < 24; monthOffset += 1) {
    const cursor = new Date(Date.UTC(year, month + monthOffset, 1));
    for (const day of [1, 16]) {
      const value = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cutoffAt = officialDrawCutoffAt(value);
      if (cutoffAt && cutoffAt.getTime() > now.getTime()) dates.push(value);
      if (dates.length === count) break;
    }
  }

  return dates;
}

const THAI_DRAW_DATE = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function nextOfficialDrawDate(raw: string): Date | null {
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

  if (day === 1) return selected;
  if (day <= 16) return new Date(Date.UTC(year, month, 16));
  return new Date(Date.UTC(year, month + 1, 1));
}

export function officialDrawName(raw: string): string | null {
  const date = nextOfficialDrawDate(raw);
  return date ? THAI_DRAW_DATE.format(date) : null;
}

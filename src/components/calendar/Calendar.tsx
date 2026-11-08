"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarLabels, CalendarMode, DateRangeValue } from "./calendar.types";
import {
  addDays,
  addMonths,
  calendarDays,
  isDateDisabled,
  isDateInRange,
  parseISODate,
  startOfMonth,
  todayInTimeZone,
  toISODate,
} from "./calendar.utils";

const DEFAULT_LABELS: CalendarLabels = {
  previousMonth: "เดือนก่อนหน้า",
  nextMonth: "เดือนถัดไป",
  chooseMonthYear: "เลือกเดือนและปี",
  today: "วันนี้",
  clear: "ล้างวันที่",
};

type CalendarProps = {
  mode?: CalendarMode;
  value?: string;
  range?: DateRangeValue;
  onSelect: (value: string) => void;
  onClear: () => void;
  minDate?: string;
  maxDate?: string;
  disabledDate?: (date: string) => boolean;
  locale?: string;
  timeZone?: string;
  labels?: Partial<CalendarLabels>;
  footerExtra?: React.ReactNode;
};

export function Calendar({
  mode = "single",
  value = "",
  range = { startDate: "", endDate: "" },
  onSelect,
  onClear,
  minDate,
  maxDate,
  disabledDate,
  locale = "th-TH",
  timeZone = "Asia/Bangkok",
  labels: customLabels,
  footerExtra,
}: CalendarProps) {
  const labels = { ...DEFAULT_LABELS, ...customLabels };
  const today = todayInTimeZone(timeZone);
  const initial = parseISODate(value || range.startDate || range.endDate || today) ?? new Date();
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(initial));
  const [focusedDate, setFocusedDate] = useState(() => toISODate(initial));
  const [jumpOpen, setJumpOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const days = useMemo(() => calendarDays(viewMonth), [viewMonth]);
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, day) => new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, 0, 7 + day)))), [locale]);
  const monthNames = useMemo(() => Array.from({ length: 12 }, (_, month) => new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, month, 1)))), [locale]);
  const title = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(viewMonth);

  useEffect(() => {
    const button = gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusedDate}"]`);
    button?.focus({ preventScroll: true });
  }, [focusedDate, viewMonth]);

  function moveFocus(amount: number) {
    const current = parseISODate(focusedDate) ?? viewMonth;
    const next = addDays(current, amount);
    setViewMonth(startOfMonth(next));
    setFocusedDate(toISODate(next));
  }

  function select(valueToSelect: string) {
    if (!isDateDisabled(valueToSelect, minDate, maxDate, disabledDate)) onSelect(valueToSelect);
  }

  function changeMonth(amount: number) {
    const next = addMonths(viewMonth, amount);
    setViewMonth(next);
    setFocusedDate(toISODate(next));
  }

  return (
    <section className="global-calendar" aria-label="ปฏิทินเลือกวันที่">
      <header className="calendar-header">
        <span className="calendar-brand-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M6 2v3M18 2v3M3.5 8.5h17M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 12h2v2H7zM11 12h2v2h-2zM15 12h2v2h-2zM7 16h2v2H7zM11 16h2v2h-2z"/></svg>
        </span>
        <button type="button" className="calendar-title" aria-expanded={jumpOpen} aria-label={labels.chooseMonthYear} onClick={() => setJumpOpen((open) => !open)}>
          {title}<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>
        </button>
        <nav aria-label="เปลี่ยนเดือน">
          <button type="button" aria-label={labels.previousMonth} onClick={() => changeMonth(-1)}><span aria-hidden="true">‹</span></button>
          <button type="button" aria-label={labels.nextMonth} onClick={() => changeMonth(1)}><span aria-hidden="true">›</span></button>
        </nav>
      </header>

      {jumpOpen && <div className="calendar-jump" aria-label="เลือกเดือนและปี">
        <label>เดือน<select value={viewMonth.getUTCMonth()} onChange={(event) => setViewMonth(new Date(Date.UTC(viewMonth.getUTCFullYear(), Number(event.target.value), 1)))}>
          {monthNames.map((month, index) => <option key={month} value={index}>{month}</option>)}
        </select></label>
        <label>ปี<input type="number" min="1900" max="2200" value={viewMonth.getUTCFullYear()} onChange={(event) => {
          const year = Number(event.target.value);
          if (year >= 1900 && year <= 2200) setViewMonth(new Date(Date.UTC(year, viewMonth.getUTCMonth(), 1)));
        }}/></label>
      </div>}

      <div className="calendar-weekdays" aria-hidden="true">
        {weekdays.map((weekday, index) => <span key={`${weekday}-${index}`} className={index === 0 || index === 6 ? "weekend" : ""}>{weekday}</span>)}
      </div>

      <div ref={gridRef} className="calendar-grid" role="grid" aria-label={title}>
        {days.map((date) => {
          const iso = toISODate(date);
          const outside = date.getUTCMonth() !== viewMonth.getUTCMonth();
          const disabled = isDateDisabled(iso, minDate, maxDate, disabledDate);
          const selected = mode === "single" ? iso === value : iso === range.startDate || iso === range.endDate;
          const rangeStart = mode === "range" && iso === range.startDate;
          const rangeEnd = mode === "range" && iso === range.endDate;
          const inRange = mode === "range" && isDateInRange(iso, range.startDate, range.endDate);
          const classes = [outside ? "outside" : "", selected ? "selected" : "", iso === today ? "today" : "", inRange ? "in-range" : "", rangeStart ? "range-start" : "", rangeEnd ? "range-end" : ""].filter(Boolean).join(" ");
          const ariaLabel = new Intl.DateTimeFormat(locale, { dateStyle: "full", timeZone: "UTC" }).format(date);
          return <button
            key={iso}
            type="button"
            role="gridcell"
            data-date={iso}
            className={classes}
            disabled={disabled}
            aria-label={ariaLabel}
            aria-selected={selected}
            tabIndex={iso === focusedDate ? 0 : -1}
            onFocus={() => setFocusedDate(iso)}
            onClick={() => select(iso)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") { event.preventDefault(); moveFocus(-1); }
              else if (event.key === "ArrowRight") { event.preventDefault(); moveFocus(1); }
              else if (event.key === "ArrowUp") { event.preventDefault(); moveFocus(-7); }
              else if (event.key === "ArrowDown") { event.preventDefault(); moveFocus(7); }
              else if (event.key === "Home") { event.preventDefault(); moveFocus(-date.getUTCDay()); }
              else if (event.key === "End") { event.preventDefault(); moveFocus(6 - date.getUTCDay()); }
              else if (event.key === "PageUp") { event.preventDefault(); changeMonth(-1); }
              else if (event.key === "PageDown") { event.preventDefault(); changeMonth(1); }
              else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); select(iso); }
            }}
          ><span>{date.getUTCDate()}</span></button>;
        })}
      </div>

      {footerExtra}
      <footer className="calendar-footer">
        <button type="button" className="calendar-today" disabled={isDateDisabled(today, minDate, maxDate, disabledDate)} onClick={() => {
          const date = parseISODate(today)!;
          setViewMonth(startOfMonth(date));
          setFocusedDate(today);
          select(today);
        }}><span aria-hidden="true">◷</span>{labels.today}</button>
        <button type="button" className="calendar-clear" disabled={mode === "single" ? !value : !range.startDate && !range.endDate} onClick={onClear}><span aria-hidden="true">⌫</span>{labels.clear}</button>
      </footer>
    </section>
  );
}


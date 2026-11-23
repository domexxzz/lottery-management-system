"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarPopover } from "./CalendarPopover";
import { CalendarChevronIcon, CalendarFieldIcon } from "./CalendarIcons";

type MonthPickerProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  id?: string;
  name?: string;
  placeholder?: string;
  locale?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
};

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Bangkok" }).format(new Date());
}

function yearOf(value: string): number {
  return MONTH.test(value) ? Number(value.slice(0, 4)) : Number(currentMonth().slice(0, 4));
}

function monthLabel(value: string, locale: string): string {
  if (!MONTH.test(value)) return "";
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00.000Z`));
}

/** ตัวเลือกเดือนในธีมเดียวกับ DatePicker โดยไม่พึ่ง native browser month picker */
export function MonthPicker({ value, defaultValue = "", onChange, id, name, placeholder = "เลือกเดือน", locale = "th-TH", disabled = false, required = false, ariaLabel = "เลือกเดือน" }: MonthPickerProps) {
  const generatedId = useId();
  const controlId = id ?? `month-picker-${generatedId.replaceAll(":", "")}`;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selected = controlled ? value : internalValue;
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(() => yearOf(selected));
  const triggerRef = useRef<HTMLButtonElement>(null);
  const months = useMemo(() => Array.from({ length: 12 }, (_, index) => ({
    value: `${viewYear}-${String(index + 1).padStart(2, "0")}`,
    label: new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2024, index, 1))),
  })), [locale, viewYear]);

  useEffect(() => {
    if (open) setViewYear(yearOf(selected));
  }, [open, selected]);

  function change(next: string) {
    if (!controlled) setInternalValue(next);
    onChange?.(next);
  }

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  const today = currentMonth();
  return <div className="date-picker month-picker">
    {name && <input type="hidden" name={name} value={selected} />}
    <button ref={triggerRef} id={controlId} type="button" className="date-picker-trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} aria-required={required} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <CalendarFieldIcon />
      <span className={selected ? "" : "placeholder"}>{selected ? monthLabel(selected, locale) : placeholder}</span>
      <CalendarChevronIcon />
    </button>
    <CalendarPopover open={open} anchor={triggerRef} onClose={() => setOpen(false)} labelledBy={controlId}>
      <section className="global-calendar month-calendar" aria-label="ปฏิทินเลือกเดือน">
        <header className="calendar-header">
          <span className="calendar-brand-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 2v3M18 2v3M3.5 8.5h17M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg></span>
          <strong>{new Intl.DateTimeFormat(locale, { year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(viewYear, 0, 1)))}</strong>
          <nav aria-label="เปลี่ยนปี">
            <button type="button" aria-label="ปีก่อนหน้า" onClick={() => setViewYear((year) => year - 1)}><span aria-hidden="true">‹</span></button>
            <button type="button" aria-label="ปีถัดไป" onClick={() => setViewYear((year) => year + 1)}><span aria-hidden="true">›</span></button>
          </nav>
        </header>
        <div className="month-calendar-grid" role="grid" aria-label={`เลือกเดือน ปี ${viewYear}`}>
          {months.map((month) => <button key={month.value} type="button" role="gridcell" aria-selected={selected === month.value} className={selected === month.value ? "selected" : month.value === today ? "today" : ""} onClick={() => { change(month.value); close(); }}>{month.label}</button>)}
        </div>
        <footer className="calendar-footer">
          <button type="button" onClick={() => { change(today); close(); }}><span aria-hidden="true">◷</span>เดือนนี้</button>
          <button type="button" disabled={!selected} onClick={() => { change(""); close(); }}><span aria-hidden="true">⌫</span>ล้างเดือน</button>
        </footer>
      </section>
    </CalendarPopover>
  </div>;
}

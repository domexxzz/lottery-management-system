"use client";

import { useId, useRef, useState } from "react";
import { Calendar } from "./Calendar";
import { CalendarPopover } from "./CalendarPopover";
import type { DateRangeValue } from "./calendar.types";
import { formatDate } from "./calendar.utils";
import { CalendarChevronIcon, CalendarFieldIcon } from "./CalendarIcons";

type DateRangePickerProps = {
  startDate: string;
  endDate: string;
  onChange: (value: DateRangeValue) => void;
  startLabel?: string;
  endLabel?: string;
  startPlaceholder?: string;
  endPlaceholder?: string;
  minDate?: string;
  maxDate?: string;
  disabledDate?: (date: string) => boolean;
  locale?: string;
};

export function DateRangePicker({ startDate, endDate, onChange, startLabel = "ตั้งแต่", endLabel = "ถึงวันที่", startPlaceholder = "เลือกวันเริ่มต้น", endPlaceholder = "เลือกวันสิ้นสุด", minDate, maxDate, disabledDate, locale = "th-TH" }: DateRangePickerProps) {
  const generatedId = useId().replaceAll(":", "");
  const [active, setActive] = useState<"start" | "end" | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLButtonElement>(null);
  const anchor = active === "end" ? endRef : startRef;
  const activeId = active === "end" ? `range-end-${generatedId}` : `range-start-${generatedId}`;

  function select(date: string) {
    if (active === "end") {
      if (!startDate) {
        onChange({ startDate: date, endDate: "" });
        setActive("end");
      } else if (date >= startDate) {
        onChange({ startDate, endDate: date });
        setActive(null);
        endRef.current?.focus();
      }
      return;
    }
    onChange({ startDate: date, endDate: endDate && endDate >= date ? endDate : "" });
    setActive("end");
  }

  function clear() {
    if (active === "end") onChange({ startDate, endDate: "" });
    else onChange({ startDate: "", endDate: "" });
  }

  const trigger = (part: "start" | "end", label: string, current: string, placeholder: string, ref: React.RefObject<HTMLButtonElement | null>) => <label className="date-range-field">
    <span>{label}</span>
    <button ref={ref} id={`range-${part}-${generatedId}`} type="button" className="date-picker-trigger" aria-haspopup="dialog" aria-expanded={active === part} onClick={() => setActive((value) => value === part ? null : part)}>
      <CalendarFieldIcon />
      <span className={current ? "" : "placeholder"}>{current ? formatDate(current, locale) : placeholder}</span>
      <CalendarChevronIcon />
    </button>
  </label>;

  return <div className="date-range-picker">
    {trigger("start", startLabel, startDate, startPlaceholder, startRef)}
    {trigger("end", endLabel, endDate, endPlaceholder, endRef)}
    <CalendarPopover open={active !== null} anchor={anchor} onClose={() => setActive(null)} labelledBy={activeId}>
      <div className="calendar-range-status" aria-live="polite"><span>{active === "end" ? "เลือกวันสิ้นสุด" : "เลือกวันเริ่มต้น"}</span><strong>{startDate ? formatDate(startDate, locale) : "—"} <i>→</i> {endDate ? formatDate(endDate, locale) : "—"}</strong></div>
      <Calendar mode="range" range={{ startDate, endDate }} value={active === "end" ? endDate : startDate} onSelect={select} onClear={clear} minDate={active === "end" && startDate ? startDate : minDate} maxDate={maxDate} disabledDate={disabledDate} locale={locale} />
    </CalendarPopover>
  </div>;
}


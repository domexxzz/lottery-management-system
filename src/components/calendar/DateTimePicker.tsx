"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Calendar } from "./Calendar";
import { CalendarPopover } from "./CalendarPopover";
import { formatDateTime, parseISODateTime, timeInTimeZone, todayInTimeZone } from "./calendar.utils";
import { CalendarChevronIcon, CalendarFieldIcon } from "./CalendarIcons";

type DateTimePickerProps = {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  minDate?: string;
  maxDate?: string;
  placeholder?: string;
  locale?: string;
  required?: boolean;
};

export function DateTimePicker({ value, onChange, id, minDate, maxDate, placeholder = "เลือกวันและเวลา", locale = "th-TH", required = false }: DateTimePickerProps) {
  const generatedId = useId().replaceAll(":", "");
  const controlId = id ?? `datetime-picker-${generatedId}`;
  const parsed = parseISODateTime(value);
  const selectedDate = parsed?.date ?? "";
  const selectedTime = parsed?.time ?? "00:00";
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const minuteOptions = useMemo(() => {
    const values = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
    const current = selectedTime.slice(3, 5);
    if (!values.includes(current)) values.push(current);
    return values.sort();
  }, [selectedTime]);

  function apply(date: string, time = selectedTime) {
    onChange(`${date}T${time}`);
  }

  const timeControls = <div className="calendar-time" aria-label="เลือกเวลา">
    <span aria-hidden="true">◷</span>
    <label>ชั่วโมง<select value={selectedTime.slice(0, 2)} onChange={(event) => apply(selectedDate || todayInTimeZone(), `${event.target.value}:${selectedTime.slice(3, 5)}`)}>
      {Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0")).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
    </select></label>
    <b>:</b>
    <label>นาที<select value={selectedTime.slice(3, 5)} onChange={(event) => apply(selectedDate || todayInTimeZone(), `${selectedTime.slice(0, 2)}:${event.target.value}`)}>
      {minuteOptions.map((minute) => <option key={minute} value={minute}>{minute}</option>)}
    </select></label>
    <button type="button" onClick={() => { setOpen(false); triggerRef.current?.focus(); }}>เสร็จสิ้น</button>
  </div>;

  return <div className="date-picker date-time-picker">
    <button ref={triggerRef} id={controlId} type="button" className="date-picker-trigger" aria-haspopup="dialog" aria-expanded={open} aria-required={required} onClick={() => setOpen((current) => !current)}>
      <CalendarFieldIcon />
      <span className={parsed ? "" : "placeholder"}>{parsed ? formatDateTime(value, locale) : placeholder}</span>
      <CalendarChevronIcon />
    </button>
    <CalendarPopover open={open} anchor={triggerRef} onClose={() => setOpen(false)} labelledBy={controlId}>
      <Calendar value={selectedDate} onSelect={(date) => apply(date, parsed?.time ?? timeInTimeZone())} onClear={() => onChange("")} minDate={minDate} maxDate={maxDate} locale={locale} footerExtra={timeControls} />
    </CalendarPopover>
  </div>;
}


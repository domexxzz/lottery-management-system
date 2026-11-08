"use client";

import { useId, useRef, useState } from "react";
import { Calendar } from "./Calendar";
import { CalendarPopover } from "./CalendarPopover";
import { CalendarChevronIcon, CalendarFieldIcon } from "./CalendarIcons";
import { formatDate } from "./calendar.utils";

type DatePickerProps = {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  id?: string;
  name?: string;
  minDate?: string;
  maxDate?: string;
  disabledDate?: (date: string) => boolean;
  placeholder?: string;
  locale?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
};

export function DatePicker({ value, defaultValue = "", onChange, id, name, minDate, maxDate, disabledDate, placeholder = "เลือกวันที่", locale = "th-TH", disabled = false, required = false, ariaLabel = "เลือกวันที่" }: DatePickerProps) {
  const generatedId = useId();
  const controlId = id ?? `date-picker-${generatedId.replaceAll(":", "")}`;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selected = controlled ? value : internalValue;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  function change(next: string) {
    if (!controlled) setInternalValue(next);
    onChange?.(next);
  }
  return <div className="date-picker">
    {name && <input type="hidden" name={name} value={selected} />}
    <button ref={triggerRef} id={controlId} type="button" className="date-picker-trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} aria-required={required} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      <CalendarFieldIcon />
      <span className={selected ? "" : "placeholder"}>{selected ? formatDate(selected, locale) : placeholder}</span>
      <CalendarChevronIcon />
    </button>
    <CalendarPopover open={open} anchor={triggerRef} onClose={() => setOpen(false)} labelledBy={controlId}>
      <Calendar value={selected} onSelect={(next) => { change(next); setOpen(false); triggerRef.current?.focus(); }} onClear={() => { change(""); setOpen(false); triggerRef.current?.focus(); }} minDate={minDate} maxDate={maxDate} disabledDate={disabledDate} locale={locale} />
    </CalendarPopover>
  </div>;
}


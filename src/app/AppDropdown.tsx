"use client";

import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export type AppDropdownOption = {
  value: string;
  label: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
};

type AppDropdownProps = {
  options: AppDropdownOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  id?: string;
  name?: string;
  ariaLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  searchable?: boolean;
  disabled?: boolean;
  required?: boolean;
  className?: string;
};

export function AppDropdown({
  options,
  value,
  defaultValue = "",
  onValueChange,
  id,
  name,
  ariaLabel,
  placeholder = "เลือกข้อมูล",
  searchPlaceholder = "พิมพ์เพื่อค้นหา",
  emptyMessage = "ไม่พบข้อมูล",
  searchable = false,
  disabled = false,
  required = false,
  className = "",
}: AppDropdownProps) {
  const generatedId = useId();
  const controlId = id ?? `dropdown-${generatedId.replaceAll(":", "")}`;
  const listboxId = `${controlId}-options`;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = controlled ? value : internalValue;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mounted, setMounted] = useState(false);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === selectedValue);
  const visibleOptions = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("th-TH");
    if (!normalized) return options;
    return options.filter((option) => `${option.label} ${option.description ?? ""}`.toLocaleLowerCase("th-TH").includes(normalized));
  }, [options, query]);

  function positionMenu() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const roomBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = Math.min(360, 58 + visibleOptions.length * 48);
    const openAbove = roomBelow < estimatedHeight && rect.top > roomBelow;
    setMenuStyle({
      left: Math.max(8, rect.left),
      top: openAbove ? Math.max(8, rect.top - estimatedHeight - 7) : rect.bottom + 7,
      width: Math.min(rect.width, window.innerWidth - 16),
      maxHeight: openAbove ? Math.max(140, rect.top - 16) : Math.max(140, window.innerHeight - rect.bottom - 15),
    });
  }

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    positionMenu();
    const reposition = () => positionMenu();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      document.removeEventListener("pointerdown", closeOnOutside);
    };
  }, [open, visibleOptions.length]);

  useEffect(() => {
    if (!open) return;
    window.requestAnimationFrame(() => {
      if (searchable) searchRef.current?.focus();
      else menuRef.current?.querySelector<HTMLButtonElement>("[aria-selected='true'], .app-dropdown-option")?.focus();
    });
  }, [open, searchable]);

  function choose(nextValue: string) {
    if (!controlled) setInternalValue(nextValue);
    onValueChange?.(nextValue);
    setOpen(false);
    setQuery("");
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function toggle() {
    if (disabled) return;
    setOpen((current) => !current);
  }

  const menu = open && mounted ? createPortal(
    <div ref={menuRef} id={listboxId} className="app-dropdown-menu" role="listbox" style={menuStyle} aria-label={ariaLabel ?? placeholder}>
      {searchable && <div className="app-dropdown-search-wrap"><span aria-hidden="true">⌕</span><input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
        if (event.key === "ArrowDown") { event.preventDefault(); menuRef.current?.querySelector<HTMLButtonElement>(".app-dropdown-option")?.focus(); }
      }} placeholder={searchPlaceholder} aria-label={searchPlaceholder} /></div>}
      <div className="app-dropdown-options">
        {visibleOptions.length === 0 ? <p className="app-dropdown-empty">{emptyMessage}</p> : visibleOptions.map((option) => <button
          key={option.value || "__empty__"}
          type="button"
          role="option"
          aria-selected={option.value === selectedValue}
          aria-disabled={option.disabled || undefined}
          disabled={option.disabled}
          className="app-dropdown-option"
          onClick={() => choose(option.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>(".app-dropdown-option") ?? []);
              const index = buttons.indexOf(event.currentTarget);
              const next = event.key === "ArrowDown" ? Math.min(index + 1, buttons.length - 1) : Math.max(index - 1, 0);
              buttons[next]?.focus();
            }
          }}
        >
          <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
          {option.badge && <b>{option.badge}</b>}
          {option.value === selectedValue && <i aria-hidden="true">✓</i>}
        </button>)}
      </div>
    </div>,
    document.body,
  ) : null;

  return <div ref={rootRef} className={`app-dropdown ${open ? "is-open" : ""} ${disabled ? "is-disabled" : ""} ${className}`.trim()}>
    {name && <input type="hidden" name={name} value={selectedValue} />}
    <button
      ref={triggerRef}
      id={controlId}
      type="button"
      className="app-dropdown-trigger"
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listboxId : undefined}
      aria-required={required || undefined}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(true); }
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <span className={selected ? "" : "is-placeholder"}>{selected?.label ?? placeholder}</span>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" /></svg>
    </button>
    {menu}
  </div>;
}

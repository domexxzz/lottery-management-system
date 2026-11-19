"use client";

import { useEffect, useId, useRef, useState } from "react";
import { REPORT_TERMS, type ReportTermKey } from "@/lib/reports/terms";

/**
 * ปุ่ม ⓘ อธิบายคำศัพท์ แตะเปิด/ปิดได้บนมือถือ (title อย่างเดียวใช้กับนิ้วไม่ได้)
 * แตะที่อื่นหรือกด Esc เพื่อปิด
 */
export function InfoTip({ term, text }: { term?: ReportTermKey; text?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const message = text ?? (term ? REPORT_TERMS[term].tip : "");
  const label = term ? REPORT_TERMS[term].label : "คำอธิบาย";

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!message) return null;
  return (
    <span ref={ref} className="info-tip">
      <button type="button" aria-label={`ความหมายของ ${label}`} aria-expanded={open} aria-describedby={open ? id : undefined} onClick={() => setOpen((value) => !value)}>ⓘ</button>
      {open && <span id={id} role="tooltip" className="info-tip-bubble">{message}</span>}
    </span>
  );
}

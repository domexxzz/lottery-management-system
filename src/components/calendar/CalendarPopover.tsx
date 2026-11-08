"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";

export function CalendarPopover({ open, anchor, onClose, children, labelledBy }: {
  open: boolean;
  anchor: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [style, setStyle] = useState<React.CSSProperties>({});

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    function position() {
      const element = anchor.current;
      if (!element || window.innerWidth <= 640) return setStyle({});
      const rect = element.getBoundingClientRect();
      const width = Math.min(348, window.innerWidth - 24);
      const estimatedHeight = 455;
      const openAbove = window.innerHeight - rect.bottom < estimatedHeight && rect.top > window.innerHeight - rect.bottom;
      setStyle({
        width,
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: openAbove ? Math.max(12, rect.top - estimatedHeight - 8) : rect.bottom + 8,
        maxHeight: openAbove ? Math.max(340, rect.top - 20) : Math.max(340, window.innerHeight - rect.bottom - 20),
      });
    }
    function dismiss(event: PointerEvent) {
      if (!popoverRef.current?.contains(event.target as Node) && !anchor.current?.contains(event.target as Node)) onClose();
    }
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") { event.preventDefault(); onClose(); anchor.current?.focus(); }
    }
    position();
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [anchor, onClose, open]);

  if (!mounted || !open) return null;
  return createPortal(<div ref={popoverRef} className="calendar-popover" style={style} role="dialog" aria-modal="false" aria-labelledby={labelledBy}>{children}</div>, document.body);
}


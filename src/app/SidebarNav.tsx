"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Role } from "@prisma/client";
import { MENU_ITEMS as ITEMS } from "@/lib/navigation";
import { DashboardIcon } from "./DashboardIcon";

export function SidebarNav({ role, onNavigate }: { role: Role; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [tooltip, setTooltip] = useState<{ label: string; top: number; left: number } | null>(null);

  function showTooltip(element: HTMLElement, label: string) {
    const rect = element.getBoundingClientRect();
    setTooltip({
      label,
      top: Math.min(Math.max(rect.top + rect.height / 2, 24), window.innerHeight - 24),
      left: rect.right + 10,
    });
  }

  return (
    <>
      <nav aria-label="เมนูหลัก" className="side-nav">
        {ITEMS.filter((item) => item.roles.includes(role)).map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link key={item.href} className={active ? "active" : undefined} href={item.href}
              aria-label={item.label} title={item.label} aria-current={active ? "page" : undefined} onNavigate={onNavigate}
              onMouseEnter={(event) => showTooltip(event.currentTarget, item.label)}
              onMouseLeave={() => setTooltip(null)}
              onFocus={(event) => showTooltip(event.currentTarget, item.label)}
              onBlur={() => setTooltip(null)}>
              <DashboardIcon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {tooltip && <span className="side-nav-tooltip" role="tooltip" style={{ top: tooltip.top, left: tooltip.left }}>{tooltip.label}</span>}
    </>
  );
}

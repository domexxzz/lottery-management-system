"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import type { Role } from "@prisma/client";
import { DashboardIcon, type DashboardIconName } from "./DashboardIcon";

type MenuItem = {
  href: string;
  label: string;
  icon: DashboardIconName;
  roles: readonly Role[];
};

const ALL_ROLES: Role[] = ["OWNER", "ADMIN", "AGENT"];
const MANAGEMENT_ROLES: Role[] = ["OWNER", "ADMIN"];
const OWNER_ROLES: Role[] = ["OWNER"];
const AUDIT_ROLES: Role[] = ["OWNER", "ADMIN"];

const ITEMS: MenuItem[] = [
  { href: "/", label: "ภาพรวม", icon: "home", roles: ALL_ROLES },
  { href: "/bills", label: "รายการบิล", icon: "bill", roles: ALL_ROLES },
  { href: "/draws", label: "งวด", icon: "draw", roles: ALL_ROLES },
  { href: "/reports", label: "รายงาน", icon: "report", roles: ALL_ROLES },
  { href: "/evidence", label: "ตรวจหลักฐาน", icon: "evidence", roles: AUDIT_ROLES },
  { href: "/audit", label: "ประวัติการตรวจผลรางวัล", icon: "audit", roles: AUDIT_ROLES },
  { href: "/analytics", label: "วิเคราะห์เชิงลึก", icon: "analytics", roles: OWNER_ROLES },
  { href: "/chat", label: "ผู้ช่วยล็อตเตอรี่", icon: "chat", roles: OWNER_ROLES },
  // เปิดให้ทุกบทบาท กฎว่าใครคุยกับใครได้บังคับที่ชั้น service
  { href: "/messages", label: "ข้อความ", icon: "chat", roles: ALL_ROLES },
  { href: "/prize-types", label: "Rulebook รางวัล", icon: "book", roles: MANAGEMENT_ROLES },
  { href: "/agents", label: "ภาพรวม Agent", icon: "agent", roles: MANAGEMENT_ROLES },
  { href: "/users", label: "จัดการผู้ใช้งาน", icon: "lock", roles: OWNER_ROLES },
];

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

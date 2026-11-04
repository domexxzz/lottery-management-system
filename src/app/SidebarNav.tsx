"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@prisma/client";
import { DashboardIcon, type DashboardIconName } from "./DashboardIcon";

type MenuItem = {
  href: string;
  label: string;
  icon: DashboardIconName;
  roles: readonly Role[];
};

const ALL_ROLES: Role[] = ["OWNER", "ADMIN", "CHECKER", "AGENT"];
const MANAGEMENT_ROLES: Role[] = ["OWNER", "ADMIN"];
const AUDIT_ROLES: Role[] = ["OWNER", "ADMIN", "CHECKER"];

const ITEMS: MenuItem[] = [
  { href: "/", label: "ภาพรวม", icon: "home", roles: ALL_ROLES },
  { href: "/bills", label: "รายการบิล", icon: "bill", roles: ALL_ROLES },
  { href: "/draws", label: "รอบ", icon: "draw", roles: ALL_ROLES },
  { href: "/reports", label: "รายงาน", icon: "report", roles: ALL_ROLES },
  { href: "/audit", label: "ประวัติการตรวจ", icon: "audit", roles: AUDIT_ROLES },
  { href: "/analytics", label: "วิเคราะห์เชิงลึก", icon: "analytics", roles: MANAGEMENT_ROLES },
  { href: "/prize-types", label: "Rulebook รางวัล", icon: "book", roles: MANAGEMENT_ROLES },
  { href: "/agents", label: "จัดการ Agent", icon: "agent", roles: MANAGEMENT_ROLES },
];

export function SidebarNav({ role }: { role: Role }) {
  const pathname = usePathname();

  return (
    <nav aria-label="เมนูหลัก" className="side-nav">
      {ITEMS.filter((item) => item.roles.includes(role)).map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} className={active ? "active" : undefined} href={item.href}>
            <DashboardIcon name={item.icon} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

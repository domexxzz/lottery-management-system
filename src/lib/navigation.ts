import type { Role } from "@prisma/client";
import type { DashboardIconName } from "@/app/DashboardIcon";

/**
 * เมนูหลักของแอป: แหล่งความจริงเดียวของ "ใครเห็นเมนูไหน"
 *
 * ใช้ทั้งแถบเมนูด้านข้างและคู่มือการใช้งานของผู้ช่วย AI
 * เพิ่มหรือย้ายเมนูที่นี่ที่เดียว คู่มือจะอัปเดตตามโดยไม่ต้องแก้ข้อความ
 */
export type MenuItem = {
  href: string;
  label: string;
  icon: DashboardIconName;
  roles: readonly Role[];
};

const ALL_ROLES: Role[] = ["GODMODE", "OWNER", "ADMIN", "AGENT"];
const MANAGEMENT_ROLES: Role[] = ["GODMODE", "OWNER", "ADMIN"];
const OWNER_ROLES: Role[] = ["GODMODE", "OWNER"];
const AUDIT_ROLES: Role[] = ["GODMODE", "OWNER", "ADMIN"];

export const MENU_ITEMS: readonly MenuItem[] = [
  { href: "/", label: "ภาพรวม", icon: "home", roles: MANAGEMENT_ROLES },
  { href: "/bills", label: "รายการบิล", icon: "bill", roles: ALL_ROLES },
  { href: "/draws", label: "งวด", icon: "draw", roles: ALL_ROLES },
  { href: "/numbers", label: "สถานะเลขเต็ม", icon: "alert", roles: MANAGEMENT_ROLES },
  { href: "/reports", label: "รายงาน", icon: "report", roles: MANAGEMENT_ROLES },
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

export function menuFor(role: Role): MenuItem[] {
  return MENU_ITEMS.filter((item) => item.roles.includes(role));
}

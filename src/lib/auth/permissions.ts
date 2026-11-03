import type { Role } from "@prisma/client";

/**
 * Permission Matrix จากเอกสารบทที่ 2
 *
 * ข้อกำหนดสำคัญ: ฝั่ง Server ต้องตรวจสิทธิ์ทุกคำขอ ไม่พึ่งการซ่อนปุ่มบนหน้าจอ
 * ไฟล์นี้คือแหล่งความจริงเดียวของสิทธิ์ ทั้ง UI และ API อ่านจากที่นี่
 */
export const PERMISSIONS = [
  "report.viewAllAgents",
  "bill.viewOwn",
  "bill.create",
  "bill.confirm",
  "bill.editBeforeCutoff",
  "bill.proposeChangeAfterCutoff",
  "bill.approveChangeAfterCutoff",
  "result.enter",
  "result.approve",
  "settlement.calculate",
  "settlement.reconcile",
  "settlement.approve",
  "audit.viewAll",
  "audit.viewOwn",
  "agent.manage",
  "draw.manage",
  "user.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * สิทธิ์ของแต่ละบทบาท
 *
 * หมายเหตุการตีความจากตารางในเอกสาร:
 * - "ลงผลรางวัล: Admin = Maker, Checker = Checker" จึงแยกเป็น result.enter กับ result.approve
 *   และ Owner ได้ทั้งสองสิทธิ์ แต่ service layer ยังห้ามคนเดียวกันเป็นทั้ง Maker และ Checker
 *   ของผลใบเดียวกัน (ดู assertDifferentMakerChecker)
 * - "แก้หรือยกเลิกหลัง Cutoff: Admin เสนอหรือดำเนินการ / Owner อนุมัติ" จึงแยกเป็น
 *   propose กับ approve
 * - "แก้บิลก่อน Cutoff: Agent ตามนโยบาย" — ให้สิทธิ์ไว้ แล้วบังคับนโยบายเพิ่มในชั้น service
 *   (แก้ได้เฉพาะบิลของตนเองที่ยังเป็น DRAFT)
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [
    "report.viewAllAgents",
    "bill.viewOwn",
    "bill.create",
    "bill.confirm",
    "bill.editBeforeCutoff",
    "bill.proposeChangeAfterCutoff",
    "bill.approveChangeAfterCutoff",
    "result.enter",
    "result.approve",
    "settlement.calculate",
    "settlement.reconcile",
    "settlement.approve",
    "audit.viewAll",
    "audit.viewOwn",
    "agent.manage",
    "draw.manage",
    "user.manage",
  ],
  ADMIN: [
    "report.viewAllAgents",
    "bill.viewOwn",
    "bill.create",
    "bill.confirm",
    "bill.editBeforeCutoff",
    "bill.proposeChangeAfterCutoff",
    "result.enter",
    "settlement.calculate",
    "settlement.reconcile",
    "audit.viewAll",
    "audit.viewOwn",
    "agent.manage",
    "draw.manage",
    "user.manage",
  ],
  CHECKER: [
    "report.viewAllAgents",
    "bill.viewOwn",
    "result.approve",
    "settlement.reconcile",
    "audit.viewAll",
    "audit.viewOwn",
  ],
  AGENT: ["bill.viewOwn", "bill.create", "bill.confirm", "bill.editBeforeCutoff", "audit.viewOwn"],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

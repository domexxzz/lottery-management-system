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
  "result.proposeCorrection",
  "result.approveCorrection",
  "settlement.calculate",
  "settlement.reconcile",
  "settlement.approve",
  "audit.viewAll",
  "audit.viewOwn",
  "agent.manage",
  "draw.manage",
  "user.manage",
  "evidence.view",
  "evidence.upload",
  "evidence.review",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * สิทธิ์ของแต่ละบทบาท
 *
 * หมายเหตุการตีความจากตารางในเอกสาร:
 * - Admin เป็นผู้ปฏิบัติงานและตรวจสอบ ผลที่กรอกถูกยืนยันในขั้นตอนเดียว
 * - "แก้หรือยกเลิกหลัง Cutoff: Admin เสนอหรือดำเนินการ / Owner อนุมัติ" จึงแยกเป็น
 *   propose กับ approve
 * - การแก้ผลรางวัลที่ประกาศไปแล้วใช้ด่านเดียวกัน: Admin เสนอ Owner อนุมัติ
 *   และผู้อนุมัติต้องไม่ใช่ผู้เสนอ เพราะผลที่ประกาศแล้วคือตัวเลขที่กลายเป็นเงินไปแล้ว
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
    "result.proposeCorrection",
    "result.approveCorrection",
    "settlement.calculate",
    "settlement.reconcile",
    "settlement.approve",
    "audit.viewAll",
    "audit.viewOwn",
    "agent.manage",
    "draw.manage",
    "user.manage",
    "evidence.view",
    "evidence.upload",
    "evidence.review",
  ],
  ADMIN: [
    "report.viewAllAgents",
    "bill.viewOwn",
    "bill.create",
    "bill.confirm",
    "bill.editBeforeCutoff",
    "bill.proposeChangeAfterCutoff",
    "result.enter",
    "result.approve",
    "result.proposeCorrection",
    "settlement.calculate",
    "settlement.reconcile",
    "audit.viewAll",
    "audit.viewOwn",
    "draw.manage",
    "evidence.view",
    "evidence.upload",
    "evidence.review",
  ],
  AGENT: [
    "bill.viewOwn",
    "bill.create",
    "bill.confirm",
    "bill.editBeforeCutoff",
    "audit.viewOwn",
    "evidence.view",
    "evidence.upload",
  ],
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

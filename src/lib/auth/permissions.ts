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
  "bill.delete",
  "bill.editBeforeCutoff",
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
  "draw.delete",
  "user.manage",
  "evidence.view",
  "evidence.upload",
  "evidence.review",
  "evidence.delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * สิทธิ์ของแต่ละบทบาท
 *
 * หมายเหตุการตีความจากตารางในเอกสาร:
 * - Admin เป็นผู้ปฏิบัติงานและตรวจสอบ ผลที่กรอกถูกยืนยันในขั้นตอนเดียว
 * - การแก้ผลรางวัลที่ประกาศไปแล้ว: Admin เสนอ Owner อนุมัติ
 *   แต่ Owner แก้เองแล้วมีผลทันที พร้อมบันทึก Audit และคำนวณยอดใหม่
 * - แก้/ลบบิลก่อน Cutoff: Agent ทำได้เฉพาะบิลของตนเอง ส่วน Admin/Owner ทำได้ทั้งองค์กร
 *   ทุกการเปลี่ยนแปลงมีผลทันทีและต้องมี Audit ก่อน/หลัง ไม่ใช้ขั้นตอนอนุมัติซ้ำ
 */
const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  OWNER: [
    "report.viewAllAgents",
    "bill.viewOwn",
    "bill.create",
    "bill.confirm",
    "bill.delete",
    "bill.editBeforeCutoff",
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
    "draw.delete",
    "user.manage",
    "evidence.view",
    "evidence.upload",
    "evidence.review",
    "evidence.delete",
  ],
  ADMIN: [
    "report.viewAllAgents",
    "bill.viewOwn",
    "bill.create",
    "bill.confirm",
    "bill.delete",
    "bill.editBeforeCutoff",
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
    "bill.delete",
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

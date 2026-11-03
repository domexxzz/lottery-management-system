import type { Prisma, Role } from "@prisma/client";
import { can } from "./permissions";

/**
 * ขอบเขตข้อมูลที่ผู้ใช้แต่ละคนมองเห็น (เอกสารบทที่ 2)
 *
 * แยกออกมาเป็นโมดูลบริสุทธิ์ ไม่พึ่ง next/headers หรือฐานข้อมูล
 * เพื่อให้ทดสอบกฎการมองเห็นได้โดยตรงโดยไม่ต้องยก request จริงขึ้นมา
 */
export type ScopeSubject = {
  organizationId: string;
  role: Role;
  userId: string;
  agentId: string | null;
};

/** ค่าที่ไม่มีทางตรงกับ agentId จริง ใช้กันกรณี agentId หลุดเป็น null */
export const NO_AGENT_SENTINEL = "__no_agent__";

/**
 * ขอบเขตที่ทุก query เกี่ยวกับบิลต้องใช้
 *
 * ห้ามเขียน prisma.bill.findMany({ where: { drawId } }) ตรง ๆ ที่ใดก็ตาม
 * ต้องเป็น prisma.bill.findMany({ where: { ...billScope(actor), drawId } }) เสมอ
 */
export function billScope(subject: ScopeSubject): Prisma.BillWhereInput {
  if (subject.role === "AGENT") {
    return {
      organizationId: subject.organizationId,
      agentId: subject.agentId ?? NO_AGENT_SENTINEL,
    };
  }
  return { organizationId: subject.organizationId };
}

/** ขอบเขตสำหรับตารางที่มี organizationId ตรง ๆ และไม่ได้แยกตาม Agent */
export function orgScope(subject: ScopeSubject): { organizationId: string } {
  return { organizationId: subject.organizationId };
}

/** Agent เห็น Audit เฉพาะเหตุการณ์ของตนเอง บทบาทที่มี audit.viewAll เห็นทั้งองค์กร */
export function auditScope(subject: ScopeSubject): Prisma.AuditEventWhereInput {
  if (can(subject.role, "audit.viewAll")) {
    return { organizationId: subject.organizationId };
  }
  return { organizationId: subject.organizationId, actorId: subject.userId };
}

import type { Actor } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

/**
 * โควตาและร่องรอยการใช้ผู้ช่วย AI
 *
 * นับจากแถว AuditEvent ไม่ใช่ตัวนับในหน่วยความจำ ด้วยเหตุผลสามข้อ
 *   1. ไม่หายเมื่อ restart หรือ deploy ใหม่
 *   2. ใช้ได้แม้รันหลาย instance เพราะทุก instance อ่านฐานเดียวกัน
 *   3. ได้ร่องรอยการตรวจสอบย้อนหลังไปในตัว ซึ่งระบบนี้ต้องมีอยู่แล้ว
 *
 * สิ่งที่บันทึก: ใคร เมื่อไร จากที่ไหน จำนวนข้อความ สำเร็จหรือไม่
 * สิ่งที่ไม่บันทึก: เนื้อคำถามและคำตอบ — D-5 (PDPA) ยังไม่ปิด
 * ถ้าภายหลังธุรกิจต้องการเก็บบทสนทนา ให้ตัดสินใจเป็นข้อแยกและบันทึกใน DECISION_LOG
 */

export const ASSISTANT_ENTITY_TYPE = "OwnerAssistant";

const DEFAULT_HOURLY_LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;

export function hourlyLimit(): number {
  const raw = Number(process.env.OWNER_ASSISTANT_HOURLY_LIMIT);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_HOURLY_LIMIT;
}

export type QuotaState = { allowed: boolean; used: number; limit: number };

/**
 * นับการเรียกของผู้ใช้รายนี้ในหนึ่งชั่วโมงที่ผ่านมา
 *
 * นับทั้งครั้งที่สำเร็จและล้มเหลว เพราะการยิงซ้ำตอนระบบปลายทางมีปัญหา
 * ก็สร้างภาระและค่าใช้จ่ายเหมือนกัน
 */
export async function checkQuota(actor: Actor, now: Date = new Date()): Promise<QuotaState> {
  const limit = hourlyLimit();
  const used = await prisma.auditEvent.count({
    where: {
      ...orgScope(actor),
      actorId: actor.userId,
      action: "ASSISTANT_QUERY",
      createdAt: { gte: new Date(now.getTime() - WINDOW_MS) },
    },
  });
  return { allowed: used < limit, used, limit };
}

export type AssistantOutcome = {
  messageCount: number;
  ok: boolean;
  latencyMs: number;
  /** รหัสข้อผิดพลาดแบบสั้น ไม่ใช่ข้อความจากผู้ให้บริการ */
  failure?: string | undefined;
};

export async function recordAssistantQuery(
  actor: Actor,
  outcome: AssistantOutcome,
): Promise<void> {
  await writeAudit(prisma, {
    organizationId: actor.organizationId,
    actorId: actor.userId,
    requestId: actor.requestId,
    ipAddress: actor.ipAddress,
    action: "ASSISTANT_QUERY",
    entityType: ASSISTANT_ENTITY_TYPE,
    entityId: actor.userId,
    after: {
      messageCount: outcome.messageCount,
      ok: outcome.ok,
      latencyMs: outcome.latencyMs,
      ...(outcome.failure ? { failure: outcome.failure } : {}),
    },
    reason: "ส่งข้อมูลสรุประดับองค์กรไปยังผู้ช่วย AI ภายนอก",
  });
}

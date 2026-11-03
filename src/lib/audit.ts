import { Prisma } from "@prisma/client";
import type { AuditAction, PrismaClient } from "@prisma/client";

/**
 * ตัวเขียน Audit ต้องรับ transaction client เสมอ
 * เพื่อให้การเปลี่ยนแปลงกับ audit เขียนลงในทรานแซกชันเดียวกัน
 * ถ้า rollback ก็หายไปพร้อมกัน ไม่เกิดกรณี audit มีแต่ข้อมูลไม่เปลี่ยน หรือกลับกัน
 */
export type TxClient = Prisma.TransactionClient | PrismaClient;

export type AuditInput = {
  organizationId: string;
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: Prisma.InputJsonValue | undefined;
  after?: Prisma.InputJsonValue | undefined;
  reason?: string | undefined;
  requestId?: string | undefined;
  ipAddress?: string | undefined;
};

export async function writeAudit(tx: TxClient, input: AuditInput): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: input.before ?? Prisma.JsonNull,
      after: input.after ?? Prisma.JsonNull,
      reason: input.reason ?? null,
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
    },
  });
}

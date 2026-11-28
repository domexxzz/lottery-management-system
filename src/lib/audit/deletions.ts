import type { Prisma, Role } from "@prisma/client";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";

/**
 * ประวัติการลบงวดและลบบิล
 *
 * การลบงวดลบบิล รายการแทง ผลรางวัล และ Settlement ทิ้งถาวรพร้อมกัน ส่วนการลบบิล
 * ตัดยอดนั้นออกจากการคำนวณทั้งหมด ทั้งสองอย่างเปลี่ยนตัวเลขเงินย้อนหลังได้ทันที
 * และเป็นสิ่งที่ภายหลังจะมีคนถามว่า "ยอดหายไปไหน"
 *
 * อ่านจาก AuditEvent ไม่ใช่ตารางใหม่ เพราะ audit ถูกเขียนในทรานแซกชันเดียวกับ
 * การลบอยู่แล้ว ถ้าทำตารางแยกจะมีโอกาสที่ลบสำเร็จแต่บันทึกไม่ขึ้น
 */

export type DeletionKind = "DRAW" | "BILL";

/** รายการของที่หายไปพร้อมงวดหรือบิลนั้น แสดงเป็นคู่ป้าย-จำนวน */
export type DeletionImpact = { label: string; value: string };

export type DeletionLogEntry = {
  id: string;
  kind: DeletionKind;
  entityId: string;
  deletedAt: Date;
  /** ชื่องวด หรือชื่อลูกค้าบนบิล */
  title: string;
  /** สถานะของสิ่งนั้น ณ ตอนลบ */
  statusBefore: string | null;
  actorName: string | null;
  actorLogin: string | null;
  actorRole: Role | null;
  reason: string | null;
  ipAddress: string | null;
  impact: DeletionImpact[];
};

export type DeletionLogFilter = {
  kind?: DeletionKind | "ALL";
  /** YYYY-MM-DD เวลาไทย */
  from?: string | undefined;
  to?: string | undefined;
  limit?: number;
};

const COUNT = new Intl.NumberFormat("th-TH");
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** เพิ่มเข้า impact เฉพาะเมื่อมีจำนวนจริง ไม่งั้นแถวจะเต็มไปด้วยเลขศูนย์ */
function addCount(impact: DeletionImpact[], label: string, value: unknown) {
  const amount = count(value);
  if (amount > 0) impact.push({ label, value: COUNT.format(amount) });
}

function drawEntry(before: Record<string, unknown>): { title: string; statusBefore: string | null; impact: DeletionImpact[] } {
  const impact: DeletionImpact[] = [];
  addCount(impact, "บิล", before.bills);
  addCount(impact, "รายการแทง", before.billItems);
  addCount(impact, "ผลรางวัล", before.results);
  addCount(impact, "Settlement", before.settlements);
  addCount(impact, "ไฟล์แนบ", before.attachments);
  addCount(impact, "การชำระเงิน", before.payments);
  addCount(impact, "เลขอั้น", before.restrictedNumbers);
  addCount(impact, "เพดานเลข", before.capOverrides);
  return {
    title: text(before.name) ?? "ไม่ทราบชื่องวด",
    statusBefore: text(before.status),
    impact,
  };
}

function billEntry(before: Record<string, unknown>): { title: string; statusBefore: string | null; impact: DeletionImpact[] } {
  const impact: DeletionImpact[] = [];
  const stake = text(before.totalStake);
  if (stake) impact.push({ label: "ยอดเดิมพัน", value: `${MONEY.format(Number(stake))} บาท` });
  if (Array.isArray(before.items)) addCount(impact, "รายการแทง", before.items.length);
  return {
    title: text(before.title) ?? "ไม่ระบุชื่อลูกค้า",
    statusBefore: text(before.status),
    impact,
  };
}

/** ขอบเขตวันตามเวลาไทย ให้ตรงกับที่ผู้ใช้เห็นบนหน้าจอ */
function bangkokStart(day: string | undefined): Date | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T00:00:00.000+07:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function bangkokEnd(day: string | undefined): Date | undefined {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T23:59:59.999+07:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function listDeletionLog(actor: Actor, filter: DeletionLogFilter = {}): Promise<DeletionLogEntry[]> {
  requirePermission(actor, "audit.viewDeletions");

  const kinds = filter.kind === "DRAW" ? ["Draw"] : filter.kind === "BILL" ? ["Bill"] : ["Draw", "Bill"];
  const from = bangkokStart(filter.from);
  const to = bangkokEnd(filter.to);
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const where: Prisma.AuditEventWhereInput = {
    ...orgScope(actor),
    action: "DELETE",
    entityType: { in: kinds },
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };

  const rows = await prisma.auditEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      entityType: true,
      entityId: true,
      before: true,
      reason: true,
      ipAddress: true,
      actor: { select: { displayName: true, login: true, role: true } },
    },
  });

  return rows.map((row): DeletionLogEntry => {
    const before = (row.before && typeof row.before === "object" && !Array.isArray(row.before)
      ? row.before
      : {}) as Record<string, unknown>;
    const kind: DeletionKind = row.entityType === "Draw" ? "DRAW" : "BILL";
    const parsed = kind === "DRAW" ? drawEntry(before) : billEntry(before);
    return {
      id: row.id,
      kind,
      entityId: row.entityId,
      deletedAt: row.createdAt,
      title: parsed.title,
      statusBefore: parsed.statusBefore,
      /*
       * actor เป็น null ได้เมื่อบัญชีคนลบถูกลบไปแล้ว
       *
       * ต้องไม่ทำให้ทั้งแถวหาย เพราะแถวที่บอกว่า "ลบโดยบัญชีที่ถูกลบแล้ว"
       * ยังมีค่ากว่าไม่มีแถวนั้นเลย
       */
      actorName: row.actor?.displayName ?? null,
      actorLogin: row.actor?.login ?? null,
      actorRole: row.actor?.role ?? null,
      reason: row.reason,
      ipAddress: row.ipAddress,
      impact: parsed.impact,
    };
  });
}

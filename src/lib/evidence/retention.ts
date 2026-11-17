import { Prisma } from "@prisma/client";
import { databaseSchema, prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError } from "@/lib/errors";
import { getStorageProvider } from "@/lib/storage/provider";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import { evidenceCutoff } from "./retention-time";

export { daysUntilExpiry, evidenceCutoff, evidenceExpiresAt, EVIDENCE_RETENTION_YEARS, remainingLabel } from "./retention-time";

/**
 * อายุการเก็บรูปหลักฐาน และการลบหลักฐานทีละมาก ๆ
 *
 * - เก็บรูปไว้ 1 ปีนับจากวันที่แนบ ครบแล้วระบบลบเอง (purgeExpiredEvidence)
 * - Owner ลบหลักฐานทั้งหมดได้ในครั้งเดียว (deleteAllEvidence)
 *
 * ทั้งสองทางไม่สนสถานะการตรวจ (รอตรวจ / ผ่าน / ตีกลับ) และไม่เปลี่ยนสถานะบิลหรือการตรวจอื่นใด
 * ลบแถวในฐานข้อมูลก่อนใน transaction เดียวพร้อม Audit แล้วค่อยลบไฟล์ใน Storage
 * ถ้าลบไฟล์ไม่สำเร็จ แถวก็หายไปแล้ว ไม่มีทางเปิดดูรูปนั้นได้อีก (เหมือนการลบทีละรูปเดิม)
 */

const DELETE_BATCH = 500;
const STORAGE_CONCURRENCY = 8;

type Row = { id: string; organizationId: string; storageKey: string; drawId: string; drawName: string };

function table(name: "bill_attachments" | "bills" | "draws") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

/** ลบแถวชุดหนึ่ง (องค์กรเดียว) พร้อม Audit สรุป แล้วลบไฟล์ คืนจำนวนที่ลบ */
async function deleteRows(
  rows: readonly Row[],
  audit: { organizationId: string; actorId: string | null; requestId?: string; ipAddress?: string; reason: string },
  storage: PrivateObjectStorage,
): Promise<number> {
  if (rows.length === 0) return 0;
  const ids = rows.map((row) => row.id);
  const byDraw = new Map<string, { drawName: string; count: number }>();
  for (const row of rows) {
    const entry = byDraw.get(row.drawId) ?? { drawName: row.drawName, count: 0 };
    entry.count += 1;
    byDraw.set(row.drawId, entry);
  }

  const deleted = await prisma.$transaction(async (tx) => {
    // ไฟล์ใหม่ที่อ้างถึงไฟล์เก่าในชุดนี้ ตัดการอ้างอิงก่อน ไม่งั้นติด unique FK
    await tx.billAttachment.updateMany({ where: { replacesId: { in: ids } }, data: { replacesId: null } });
    const result = await tx.billAttachment.deleteMany({ where: { id: { in: ids }, organizationId: audit.organizationId } });
    await writeAudit(tx, {
      organizationId: audit.organizationId,
      actorId: audit.actorId,
      requestId: audit.requestId,
      ipAddress: audit.ipAddress,
      action: "FILE_DELETED",
      entityType: "BillAttachment",
      entityId: "bulk",
      before: {
        count: result.count,
        draws: [...byDraw].map(([drawId, entry]) => ({ drawId, drawName: entry.drawName, count: entry.count })),
      },
      reason: audit.reason,
    });
    return result.count;
  });

  // ลบไฟล์ทีละไม่กี่ไฟล์พร้อมกัน ไม่ให้ยิง Storage ทีเดียวเป็นพัน
  const keys = rows.map((row) => row.storageKey);
  for (let index = 0; index < keys.length; index += STORAGE_CONCURRENCY) {
    await Promise.all(keys.slice(index, index + STORAGE_CONCURRENCY).map(async (key) => {
      try {
        await storage.delete(key);
      } catch (error) {
        console.error("Evidence row deleted but object cleanup failed", { storageKey: key, error });
      }
    }));
  }
  return deleted;
}

async function selectRows(where: Prisma.Sql, limit: number): Promise<Row[]> {
  return prisma.$queryRaw<Row[]>(Prisma.sql`
    SELECT a.id, a."organizationId", a."storageKey", d.id AS "drawId", d.name AS "drawName"
    FROM ${table("bill_attachments")} a
    JOIN ${table("bills")} b ON b.id = a."billId"
    JOIN ${table("draws")} d ON d.id = b."drawId"
    WHERE ${where}
    ORDER BY a."createdAt" ASC
    LIMIT ${limit}
  `);
}

export type EvidenceDrawSummary = { drawId: string; drawName: string; drawDate: Date | null; count: number };

/** หลักฐานที่มีอยู่ตอนนี้ แยกตามงวด ใช้แสดงในหน้าต่างยืนยันก่อนลบทั้งหมด */
export async function evidenceSummaryByDraw(actor: Actor): Promise<{ total: number; draws: EvidenceDrawSummary[] }> {
  requirePermission(actor, "evidence.delete");
  const rows = await prisma.$queryRaw<{ drawId: string; drawName: string; drawDate: Date | null; count: number }[]>(Prisma.sql`
    SELECT d.id AS "drawId", d.name AS "drawName", d."drawDate", COUNT(a.id)::int AS count
    FROM ${table("bill_attachments")} a
    JOIN ${table("bills")} b ON b.id = a."billId"
    JOIN ${table("draws")} d ON d.id = b."drawId"
    WHERE a."organizationId" = ${actor.organizationId}
    GROUP BY d.id, d.name, d."drawDate", d."cutoffAt"
    ORDER BY d."cutoffAt" DESC
  `);
  return { total: rows.reduce((sum, row) => sum + row.count, 0), draws: rows };
}

/**
 * Owner ลบหลักฐานทุกรูปขององค์กร
 *
 * expectedTotal คือจำนวนที่เห็นในหน้าต่างยืนยัน ถ้าระหว่างนั้นมีคนแนบหรือลบรูปเพิ่ม
 * จำนวนจะไม่ตรง ระบบไม่ลบและให้เปิดหน้าต่างยืนยันใหม่ จะได้ไม่ลบสิ่งที่ผู้ใช้ไม่ได้เห็น
 */
export async function deleteAllEvidence(
  actor: Actor,
  expectedTotal: number,
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<{ deleted: number }> {
  requirePermission(actor, "evidence.delete");
  const current = await prisma.billAttachment.count({ where: { organizationId: actor.organizationId } });
  if (current !== expectedTotal) {
    throw new ConflictError(`จำนวนหลักฐานเปลี่ยนไปแล้ว (ตอนนี้มี ${current} รูป) กรุณาเปิดหน้าต่างยืนยันใหม่`);
  }
  let deleted = 0;
  for (;;) {
    const rows = await selectRows(Prisma.sql`a."organizationId" = ${actor.organizationId}`, DELETE_BATCH);
    if (rows.length === 0) break;
    deleted += await deleteRows(rows, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      reason: "Owner ลบหลักฐานทั้งหมด",
    }, storage);
    if (deleted >= expectedTotal) break;
  }
  return { deleted };
}

/**
 * ลบรูปหลักฐานที่แนบมาครบ 1 ปีแล้ว ทุกองค์กร
 *
 * เรียกจาก job ตามเวลา (npm run job:evidence-retention) และเรียกแบบเบา ๆ ตอนเปิดหน้าตรวจหลักฐาน
 * ทำทีละชุด จนหมดหรือครบ maxRows
 */
export async function purgeExpiredEvidence(
  now: Date = new Date(),
  options: { maxRows?: number; storage?: PrivateObjectStorage } = {},
): Promise<{ deleted: number }> {
  const storage = options.storage ?? getStorageProvider();
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const cutoff = evidenceCutoff(now);
  let deleted = 0;
  while (deleted < maxRows) {
    const rows = await selectRows(Prisma.sql`a."createdAt" < ${cutoff}`, Math.min(DELETE_BATCH, maxRows - deleted));
    if (rows.length === 0) break;
    const byOrg = new Map<string, Row[]>();
    for (const row of rows) byOrg.set(row.organizationId, [...(byOrg.get(row.organizationId) ?? []), row]);
    for (const [organizationId, orgRows] of byOrg) {
      deleted += await deleteRows(orgRows, { organizationId, actorId: null, reason: "ลบอัตโนมัติ: เก็บครบ 1 ปีแล้ว" }, storage);
    }
  }
  return { deleted };
}

let lastOpportunisticRun = 0;

/**
 * ลบรูปที่หมดอายุแบบไม่ให้หน้าเว็บช้า: อย่างมากชั่วโมงละครั้งต่อเซิร์ฟเวอร์ ครั้งละไม่เกิน 200 รูป
 * กันไว้กรณียังไม่ได้ตั้ง job ตามเวลา ถ้าพังก็แค่บันทึก log ไม่ทำให้หน้าเปิดไม่ได้
 */
export async function purgeExpiredEvidenceSoon(): Promise<void> {
  if (Date.now() - lastOpportunisticRun < 60 * 60_000) return;
  lastOpportunisticRun = Date.now();
  try {
    await purgeExpiredEvidence(new Date(), { maxRows: 200 });
  } catch (error) {
    console.error("Evidence retention cleanup failed", error);
  }
}

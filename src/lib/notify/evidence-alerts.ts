import type { AttachmentType } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getStorageProvider } from "@/lib/storage/provider";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import { channelThreadId } from "./channels";
import { buildBillCallbackData } from "./telegram-actions";
import { sendTelegramMediaGroup, sendTelegramMessage, sendTelegramPhoto } from "./telegram";

/**
 * แจ้งเตือนเมื่อมีหลักฐานหรือสลิปส่งเข้ามารอตรวจ
 *
 * ทำงานตามรอบ ไม่ยิงตอนอัปโหลด
 *
 * ถ้ายิงตอนอัปโหลด Telegram จะกลายเป็นส่วนหนึ่งของเส้นทางอัปโหลด
 * ปลายทางช้าหรือล่มเมื่อไร ผู้ใช้รอเมื่อนั้น และแย่กว่านั้นคือเสี่ยงให้บิลพัง
 * เพราะบริการภายนอกที่ไม่เกี่ยวกับเงินเลย งานตามรอบแยกสองเรื่องนี้ขาดจากกัน
 * ล้มแล้วรอบหน้าลองใหม่ได้เอง โดยไม่มีใครรู้สึก
 *
 * กันส่งซ้ำด้วย AuditEvent ไม่ใช่คอลัมน์ใหม่หรือตัวแปรในหน่วยความจำ
 * เพราะต้องทนการรีสตาร์ต ใช้ได้กับหลาย instance และได้ร่องรอยตรวจสอบไปในตัว
 *
 * ข้อมูลที่ออกไปยังช่องทางภายนอกถูกจำกัดไว้เท่าที่จำเป็นต่อการตัดสินใจว่า
 * "ต้องเข้าไปตรวจหรือยัง" — ไม่ส่งรูปหลักฐาน ไม่ส่งรหัสอ้างอิงลูกค้า
 * และไม่ส่งเลขอ้างอิงการโอน คนอ่านกดลิงก์เข้ามาดูในระบบที่มีสิทธิ์คุมอยู่แล้ว
 */

const ENTITY_TYPE = "BillAttachment";

/** กันข้อความยาวเกินและกันงานหนักเกินในรอบเดียว */
const MAX_PER_RUN = 20;

const TYPE_LABEL: Record<AttachmentType, string> = {
  ORDER_EVIDENCE: "หลักฐานการสั่งซื้อ",
  PAYMENT_EVIDENCE: "สลิปการชำระเงิน",
  OTHER: "ไฟล์แนบอื่น",
};

export type EvidenceAlertOutcome = {
  /** จำนวนรายการที่ยังไม่เคยแจ้ง ณ ตอนเริ่มรอบนี้ */
  pending: number;
  /** จำนวนที่แจ้งสำเร็จและบันทึกกันส่งซ้ำแล้ว */
  notified: number;
  skippedReason?: "NOT_CONFIGURED" | "NOTHING_TO_SEND" | "SEND_FAILED";
  detail?: string;
};

function appUrl(path: string): string {
  const base = (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

function formatTime(value: Date, timezone: string): string {
  return value.toLocaleString("th-TH", { timeZone: timezone, dateStyle: "short", timeStyle: "short" });
}

type PendingRow = {
  id: string;
  type: AttachmentType;
  storageKey: string;
  originalName: string;
  createdAt: Date;
  organizationId: string;
  bill: {
    id: string;
    billNumber: string | null;
    totalStake: unknown;
    agent: { code: string };
    draw: { name: string };
  };
  organization: { timezone: string };
};

/** รายการที่รอตรวจและยังไม่มีแถว NOTIFICATION_SENT ของตัวเอง */
async function pendingAttachments(limit: number): Promise<PendingRow[]> {
  const rows = await prisma.billAttachment.findMany({
    where: {
      status: "PENDING",
      replacedBy: null,
      bill: { status: { notIn: ["CANCELLED"] } },
    },
    orderBy: { createdAt: "asc" },
    // ดึงเผื่อไว้ เพราะบางรายการจะถูกกรองออกด้วยเงื่อนไขว่าเคยแจ้งแล้ว
    take: limit * 4,
    select: {
      id: true,
      type: true,
      storageKey: true,
      originalName: true,
      createdAt: true,
      organizationId: true,
      bill: {
        select: {
          id: true,
          billNumber: true,
          totalStake: true,
          agent: { select: { code: true } },
          draw: { select: { name: true } },
        },
      },
      organization: { select: { timezone: true } },
    },
  });

  if (rows.length === 0) return [];

  const alreadyNotified = await prisma.auditEvent.findMany({
    where: {
      action: "NOTIFICATION_SENT",
      entityType: ENTITY_TYPE,
      entityId: { in: rows.map((row) => row.id) },
    },
    select: { entityId: true },
  });
  const notified = new Set(alreadyNotified.map((row) => row.entityId));

  return rows.filter((row) => !notified.has(row.id)).slice(0, limit) as PendingRow[];
}

/** คำบรรยายของกลุ่มหลักฐานที่เป็นของบิลเดียวกัน */
function buildCaption(rows: PendingRow[]): string {
  const first = rows[0]!;
  const stake = Number(first.bill.totalStake ?? 0).toFixed(2);
  const kinds = rows.map((row) => TYPE_LABEL[row.type]).join(" + ");
  return [
    rows.length === 1 ? `${kinds} รอตรวจ` : `${kinds} รอตรวจ (${rows.length} ไฟล์)`,
    `บิล ${first.bill.billNumber ?? "(ยังไม่ออกเลข)"} · รอบ ${first.bill.draw.name}`,
    `Agent ${first.bill.agent.code} · ยอด ${stake} บาท`,
    `ส่งเมื่อ ${formatTime(first.createdAt, first.organization.timezone)}`,
    appUrl(`/bills/${first.bill.id}`),
  ].join("\n");
}

/**
 * ปุ่มชุดเดียวที่ทำงานกับหลักฐานทุกใบของบิลนั้น
 *
 * คนตรวจดูรูปทั้งหมดพร้อมกันแล้วตัดสินทีเดียว การมีปุ่มรายไฟล์
 * ทำให้ต้องกดซ้ำและเสี่ยงกดไม่ครบจนเหลือใบค้างโดยไม่รู้ตัว
 */
function buildButtonRows(rows: PendingRow[]) {
  const billId = rows[0]!.bill.id;
  const suffix = rows.length > 1 ? "ทั้งหมด" : "";
  return [
    [
      { text: `✓ ยืนยัน${suffix}`, callbackData: buildBillCallbackData("verify", billId) },
      { text: `✗ ตีกลับ${suffix}`, callbackData: buildBillCallbackData("reject", billId) },
    ],
  ];
}

/** จัดกลุ่มตามบิล โดยรักษาลำดับเก่าไปใหม่ของบิลที่มาก่อน */
function groupByBill(rows: PendingRow[]): PendingRow[][] {
  const groups = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const existing = groups.get(row.bill.id);
    if (existing) existing.push(row);
    else groups.set(row.bill.id, [row]);
  }
  return [...groups.values()];
}

/**
 * รันหนึ่งรอบ
 *
 * หลักฐานของบิลเดียวกันถูกส่งพร้อมกัน เพราะคนตรวจต้องเห็นสลิปคู่กับ
 * หลักฐานการสั่งซื้อจึงจะตัดสินได้ว่าตรงกันหรือไม่ การแยกคนละข้อความ
 * ทำให้ต้องเลื่อนหาว่าใบไหนคู่กับใบไหน
 *
 * ข้อจำกัดของ Telegram: อัลบั้มรูปแนบปุ่มไม่ได้
 * จึงส่งอัลบั้มก่อน แล้วตามด้วยข้อความคุมที่มีปุ่มของทุกไฟล์ในบิลนั้น
 *
 * ลำดับสำคัญ: ส่งก่อน แล้วค่อยบันทึกว่าแจ้งแล้ว
 * ถ้าสลับลำดับ รายการที่ส่งไม่ออกจะถูกมองว่าแจ้งแล้วและหายเงียบ ๆ
 */
export async function runEvidenceAlerts(
  limit: number = MAX_PER_RUN,
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<EvidenceAlertOutcome> {
  const rows = await pendingAttachments(limit);

  if (rows.length === 0) {
    return { pending: 0, notified: 0, skippedReason: "NOTHING_TO_SEND" };
  }

  const threadId = channelThreadId("evidence");
  let notified = 0;
  let lastFailure: { reason: string; detail: string } | undefined;

  for (const group of groupByBill(rows)) {
    const caption = buildCaption(group);
    const buttonRows = buildButtonRows(group);

    // รูปที่อ่านไม่ได้ไม่ใช่เหตุให้ไม่แจ้ง ยังส่งข้อความพร้อมปุ่มไปก่อนได้
    const photos: { buffer: Buffer; fileName: string }[] = [];
    for (const row of group) {
      try {
        photos.push({ buffer: await storage.download(row.storageKey), fileName: row.originalName });
      } catch {
        logger.warn("evidence image unreadable", { entityId: row.id });
      }
    }

    let result;
    if (photos.length > 1) {
      result = await sendTelegramMediaGroup({ photos, caption, threadId });
      // อัลบั้มแนบปุ่มไม่ได้ ปุ่มจึงมาในข้อความถัดไป
      if (result.ok) {
        result = await sendTelegramMessage("เลือกการดำเนินการ", {
          threadId,
          buttons: buttonRows,
        });
      }
    } else if (photos.length === 1) {
      result = await sendTelegramPhoto({
        photo: photos[0]!.buffer,
        fileName: photos[0]!.fileName,
        caption,
        buttons: buttonRows,
        threadId,
      });
    } else {
      result = await sendTelegramMessage(`${caption}
(อ่านไฟล์แนบไม่ได้ ดูในระบบแทน)`, {
        threadId,
        buttons: buttonRows,
      });
    }

    if (!result.ok) {
      lastFailure = { reason: result.reason, detail: result.detail };
      // หยุดทั้งรอบ กลุ่มที่เหลือยังไม่ถูกบันทึก จึงถูกหยิบมาใหม่รอบหน้า
      break;
    }

    for (const row of group) {
      await writeAudit(prisma, {
        organizationId: row.organizationId,
        actorId: null,
        action: "NOTIFICATION_SENT",
        entityType: ENTITY_TYPE,
        entityId: row.id,
        after: {
          channel: "evidence",
          attachmentType: row.type,
          billNumber: row.bill.billNumber,
          withPhoto: photos.length > 0,
          groupedWith: group.length,
        },
        reason: "แจ้งเตือนหลักฐานรอตรวจไปยัง Telegram",
      });
      notified += 1;
    }
  }

  if (notified === 0 && lastFailure) {
    logger.warn("evidence alert failed", { reason: lastFailure.reason, pending: rows.length });
    return {
      pending: rows.length,
      notified: 0,
      skippedReason: lastFailure.reason === "NOT_CONFIGURED" ? "NOT_CONFIGURED" : "SEND_FAILED",
      detail: lastFailure.detail,
    };
  }

  logger.info("evidence alert sent", { count: notified });
  return {
    pending: rows.length,
    notified,
    ...(lastFailure ? { skippedReason: "SEND_FAILED" as const, detail: lastFailure.detail } : {}),
  };
}

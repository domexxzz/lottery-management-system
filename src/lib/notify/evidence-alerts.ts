import type { AttachmentType } from "@prisma/client";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getStorageProvider } from "@/lib/storage/provider";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import { channelThreadId } from "./channels";
import { buildBillCallbackData } from "./telegram-actions";
import { sendTelegramMessage, sendTelegramPhoto } from "./telegram";

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
 * ข้อมูลที่ออกไปยังช่องทางภายนอกถูกจำกัดไว้เท่าที่จำเป็นต่อการตัดสินใจ
 * ไม่ส่งรหัสอ้างอิงลูกค้าและไม่ส่งเลขอ้างอิงการโอน
 * คนอ่านกดลิงก์เข้ามาดูรายละเอียดในระบบที่มีสิทธิ์คุมอยู่แล้ว
 *
 * รูปที่ส่งเข้าแชทมีได้ใบเดียวคือหลักฐานการสั่งซื้อ สลิปการชำระเงินไม่ถูกส่ง
 * เพราะสลิปมีเลขบัญชีและเลขอ้างอิงการโอนอยู่บนหน้าภาพ ซึ่งไม่ควรออกไปอยู่ใน
 * แชทที่ควบคุมสิทธิ์ไม่ได้เท่าระบบ ส่วนปุ่มยังทำงานกับทั้งบิลเหมือนเดิม
 * คำบรรยายจึงต้องบอกจำนวนไฟล์ที่ไม่ได้แสดงเสมอ ไม่งั้นคนกดยืนยันโดยไม่รู้ว่า
 * ยืนยันอะไรไปบ้าง
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
    drawSequence: number | null;
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
          drawSequence: true,
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

/**
 * รูปที่ส่งเข้าแชท — หลักฐานการสั่งซื้อใบแรกของบิลเท่านั้น
 *
 * rows เรียงเก่าไปใหม่อยู่แล้ว find จึงได้ใบที่ส่งเข้ามาก่อน
 * คืน undefined เมื่อบิลนั้นมีแต่สลิป ซึ่งยังต้องแจ้ง ไม่ใช่เงียบ
 * ไม่งั้นสลิปจะค้างรอตรวจโดยไม่มีใครรู้
 */
function photoRowOf(rows: PendingRow[]): PendingRow | undefined {
  return rows.find((row) => row.type === "ORDER_EVIDENCE");
}

/** คำบรรยายของกลุ่มหลักฐานที่เป็นของบิลเดียวกัน */
function buildCaption(
  rows: PendingRow[],
  shown: PendingRow | undefined,
  photoReadable: boolean,
): string {
  const first = rows[0]!;
  const stake = Number(first.bill.totalStake ?? 0).toFixed(2);
  const hidden = rows.filter((row) => row !== shown);

  const lines = [
    `${TYPE_LABEL[(shown ?? first).type]} รอตรวจ`,
    `${visibleBillNumber(first.bill.drawSequence)} · รอบ ${first.bill.draw.name}`,
    `Agent ${first.bill.agent.code} · ยอด ${stake} บาท`,
    `ส่งเมื่อ ${formatTime(first.createdAt, first.organization.timezone)}`,
  ];

  if (shown && !photoReadable) lines.push("(อ่านไฟล์รูปไม่ได้ ดูในระบบแทน)");

  // ปุ่มทำงานกับทั้งบิล คนกดจึงต้องรู้ว่ามีอะไรที่ไม่ได้เห็นบ้าง
  if (hidden.length > 0) {
    const kinds = [...new Set(hidden.map((row) => TYPE_LABEL[row.type]))].join(" · ");
    // "อีก" ใช้ได้เฉพาะเมื่อมีรูปแสดงอยู่แล้ว ไม่งั้นอ่านแล้วงงว่าอีกจากอะไร
    lines.push(
      shown
        ? `อีก ${hidden.length} ไฟล์ไม่ได้ส่งมาในแชท: ${kinds}`
        : `ไม่ได้ส่งรูปมาในแชท (${hidden.length} ไฟล์: ${kinds})`,
    );
    lines.push("กดยืนยันคือยืนยันทั้งบิล รวมไฟล์ที่ไม่ได้แสดง");
  }

  lines.push(appUrl(`/bills/${first.bill.id}`));
  return lines.join("\n");
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
    const shown = photoRowOf(group);
    const buttonRows = buildButtonRows(group);

    // รูปที่อ่านไม่ได้ไม่ใช่เหตุให้ไม่แจ้ง ยังส่งข้อความพร้อมปุ่มไปก่อนได้
    let photo: { buffer: Buffer; fileName: string } | undefined;
    if (shown) {
      try {
        photo = { buffer: await storage.download(shown.storageKey), fileName: shown.originalName };
      } catch {
        logger.warn("evidence image unreadable", { entityId: shown.id });
      }
    }

    const caption = buildCaption(group, shown, photo !== undefined);

    const result = photo
      ? await sendTelegramPhoto({
          photo: photo.buffer,
          fileName: photo.fileName,
          caption,
          buttons: buttonRows,
          threadId,
        })
      : await sendTelegramMessage(caption, { threadId, buttons: buttonRows });

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
          billNumber: visibleBillNumber(row.bill.drawSequence),
          withPhoto: photo !== undefined,
          groupedWith: group.length,
          shownInChat: row.id === shown?.id,
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

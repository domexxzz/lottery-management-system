import type { Actor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { reviewAttachment } from "@/lib/evidence/service";
import { logger } from "@/lib/logger";
import { AppError } from "@/lib/errors";

/**
 * รับการกดปุ่มจาก Telegram แล้วแปลงเป็นการตรวจหลักฐานจริง
 *
 * หลักการที่ห้ามหย่อน
 *
 * 1. ใครกดต้องสืบกลับได้เสมอ
 *    คนที่ผูกบัญชีไว้ ทำในนามตัวเอง
 *    สมาชิกกลุ่มที่ยังไม่ผูก กดได้เฉพาะในกลุ่มที่ตั้งไว้ (TELEGRAM_CHAT_ID)
 *    ระบบทำในนาม Owner ขององค์กรนั้น และเก็บเลขบัญชีกับชื่อ Telegram ของคนกด
 *    ไว้ใน requestId ของ Audit ทุกแถว จึงยังตามได้ว่าใครเป็นคนกด
 *    กดจากแชทอื่น (เช่นข้อความที่ถูกส่งต่อ) และยังไม่ผูก จะถูกปฏิเสธ
 *
 * 2. สิทธิ์ตรวจสอบที่ชั้น service เหมือนเดิมทุกประการ
 *    ไม่มีทางลัดสำหรับ Telegram การกดปุ่มเรียก reviewAttachment ตัวเดียว
 *    กับที่หน้าเว็บใช้ จึงได้ด่านสิทธิ์ ขอบเขตองค์กร และ Audit เท่ากัน
 *
 * 3. กดซ้ำต้องไม่พัง
 *    คนสองคนอาจกดพร้อมกัน หรือกดซ้ำเพราะไม่เห็นผล
 *    service เดิมปฏิเสธรายการที่ตรวจไปแล้วอยู่แล้ว จึงปลอดภัยโดยโครงสร้าง
 */

/**
 * สิ่งที่ปุ่มสั่งให้ทำ
 *
 * ระดับบิลคือปกติ เพราะคนตรวจดูหลักฐานทุกใบของบิลพร้อมกันแล้วตัดสินทีเดียว
 * ระดับไฟล์ยังรองรับไว้ เพื่อให้ปุ่มในข้อความที่ส่งไปก่อนหน้านี้ยังกดได้
 *
 * callback_data ของ Telegram จำกัด 64 ไบต์ จึงใช้รูปแบบสั้นที่สุด
 */
export type EvidenceAction =
  | { scope: "attachment"; kind: "verify" | "reject"; attachmentId: string }
  | { scope: "bill"; kind: "verify" | "reject"; billId: string };

const PREFIX = {
  billVerify: "ev:bv:",
  billReject: "ev:br:",
  verify: "ev:v:",
  reject: "ev:r:",
} as const;

export function buildBillCallbackData(kind: "verify" | "reject", billId: string): string {
  return `${kind === "verify" ? PREFIX.billVerify : PREFIX.billReject}${billId}`;
}

export function buildCallbackData(kind: "verify" | "reject", attachmentId: string): string {
  return `${kind === "verify" ? PREFIX.verify : PREFIX.reject}${attachmentId}`;
}

export function parseCallbackData(raw: string): EvidenceAction | null {
  // ตรวจรูปแบบระดับบิลก่อน เพราะ ev:b... ขึ้นต้นเหมือน ev:... ถ้าสลับลำดับจะจับผิดตัว
  if (raw.startsWith(PREFIX.billVerify)) {
    const id = raw.slice(PREFIX.billVerify.length);
    return id ? { scope: "bill", kind: "verify", billId: id } : null;
  }
  if (raw.startsWith(PREFIX.billReject)) {
    const id = raw.slice(PREFIX.billReject.length);
    return id ? { scope: "bill", kind: "reject", billId: id } : null;
  }
  if (raw.startsWith(PREFIX.verify)) {
    const id = raw.slice(PREFIX.verify.length);
    return id ? { scope: "attachment", kind: "verify", attachmentId: id } : null;
  }
  if (raw.startsWith(PREFIX.reject)) {
    const id = raw.slice(PREFIX.reject.length);
    return id ? { scope: "attachment", kind: "reject", attachmentId: id } : null;
  }
  return null;
}

export type ActionOutcome = {
  ok: boolean;
  /** ข้อความสั้นที่เด้งให้คนกดเห็น Telegram จำกัดราว 200 ตัวอักษร */
  message: string;
};

/**
 * หาผู้ใช้ในระบบจากบัญชี Telegram ที่กดปุ่ม
 *
 * คืน null เมื่อยังไม่ผูก หรือผูกกับบัญชีที่ถูกระงับ
 * ผู้ใช้บทบาท AGENT ที่ผูกไว้ก็ผ่านตรงนี้ได้ แต่จะไปตกที่ด่านสิทธิ์ของ service
 */
const USER_SELECT = {
  id: true,
  organizationId: true,
  role: true,
  displayName: true,
  mustChangePassword: true,
} as const;

/** ร่องรอยของคนกดที่เก็บลง Audit (requestId) เช่น "telegram:8627938804 สมชาย (@somchai)" */
function telegramTrace(telegramUserId: string, name: string | undefined): string {
  return `telegram:${telegramUserId}${name ? ` ${name}` : ""}`.slice(0, 190);
}

async function actorFromTelegram(telegramUserId: string, trace: string): Promise<Actor | null> {
  const user = await prisma.user.findFirst({
    where: { telegramUserId, status: "ACTIVE" },
    select: USER_SELECT,
  });
  if (!user) return null;

  return {
    userId: user.id,
    organizationId: user.organizationId,
    role: user.role,
    displayName: user.displayName,
    agentId: null,
    mustChangePassword: user.mustChangePassword,
    requestId: trace,
    ipAddress: undefined,
  };
}

/**
 * สมาชิกกลุ่มที่ยังไม่ผูกบัญชี: ทำในนาม Owner ขององค์กรที่เป็นเจ้าของบิล
 *
 * หาองค์กรจากตัวบิล/ไฟล์ที่ปุ่มชี้ ไม่ใช่จากคนกด เพราะคนกดไม่มีบัญชีในระบบ
 * ปุ่มกดได้เฉพาะในกลุ่มที่ตั้งไว้ ซึ่งบอทส่งหลักฐานขององค์กรนั้นเท่านั้น
 */
async function groupDelegate(action: EvidenceAction, name: string, trace: string): Promise<Actor | null> {
  const target = action.scope === "bill"
    ? await prisma.bill.findUnique({ where: { id: action.billId }, select: { organizationId: true } })
    : await prisma.billAttachment.findUnique({ where: { id: action.attachmentId }, select: { organizationId: true } });
  if (!target) return null;

  const owner = await prisma.user.findFirst({
    where: { organizationId: target.organizationId, role: "OWNER", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: USER_SELECT,
  });
  if (!owner) return null;

  return {
    userId: owner.id,
    organizationId: owner.organizationId,
    role: owner.role,
    // ชื่อที่ขึ้นในแชทเป็นชื่อคนกดจริง ส่วน Audit ผูกกับ Owner และเก็บชื่อคนกดไว้ใน requestId
    displayName: name,
    agentId: null,
    mustChangePassword: false,
    requestId: trace,
    ipAddress: undefined,
  };
}

/**
 * หาหลักฐานที่ยังรอตรวจของบิลนั้น
 *
 * กรองด้วยองค์กรของผู้กดเสมอ ไม่ใช่เชื่อ id ที่มากับปุ่ม
 * เพราะ callback_data เป็นข้อความที่ปลอมได้ ถ้าใครรู้รูปแบบ
 */
async function pendingOfBill(actor: Actor, billId: string): Promise<string[]> {
  const rows = await prisma.billAttachment.findMany({
    where: {
      billId,
      organizationId: actor.organizationId,
      status: "PENDING",
      replacedBy: null,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

export async function handleEvidenceAction(input: {
  telegramUserId: string;
  /** ชื่อใน Telegram ของคนกด ใช้แสดงผลและบันทึก Audit */
  telegramName?: string | undefined;
  /** กดจากกลุ่มที่ตั้งไว้ใน TELEGRAM_CHAT_ID — สมาชิกที่ยังไม่ผูกบัญชีกดได้เฉพาะกรณีนี้ */
  fromConfiguredGroup?: boolean;
  action: EvidenceAction;
  /** เหตุผลที่ตีกลับ จำเป็นเมื่อ kind เป็น reject */
  reason?: string | undefined;
}): Promise<ActionOutcome> {
  const trace = telegramTrace(input.telegramUserId, input.telegramName);
  const actor =
    (await actorFromTelegram(input.telegramUserId, trace)) ??
    (input.fromConfiguredGroup
      ? await groupDelegate(input.action, input.telegramName || `Telegram ${input.telegramUserId}`, trace)
      : null);

  if (!actor) {
    return {
      ok: false,
      message: "บัญชี Telegram นี้ยังไม่ได้ผูกกับผู้ใช้ในระบบ จึงกดไม่ได้",
    };
  }

  if (input.action.kind === "reject" && !input.reason?.trim()) {
    return { ok: false, message: "การตีกลับต้องระบุเหตุผล" };
  }

  const targets =
    input.action.scope === "bill"
      ? await pendingOfBill(actor, input.action.billId)
      : [input.action.attachmentId];

  if (targets.length === 0) {
    return { ok: false, message: "ไม่มีหลักฐานที่รอตรวจของบิลนี้แล้ว" };
  }

  const decision = input.action.kind === "verify" ? "VERIFIED" : "REJECTED";
  let done = 0;
  let firstError: string | undefined;

  for (const attachmentId of targets) {
    try {
      await reviewAttachment(actor, attachmentId, decision, input.reason);
      done += 1;
    } catch (error) {
      if (error instanceof AppError) {
        firstError ??= error.message;
        logger.warn("telegram evidence action rejected", {
          userId: actor.userId,
          entityId: attachmentId,
          errorMessage: error.message,
        });
        continue;
      }
      logger.error("telegram evidence action failed", { entityId: attachmentId });
      firstError ??= "ดำเนินการไม่สำเร็จ กรุณาลองใหม่หรือทำในระบบ";
    }
  }

  if (done === 0) {
    return { ok: false, message: firstError ?? "ดำเนินการไม่สำเร็จ" };
  }

  logger.info("telegram evidence action", {
    userId: actor.userId,
    decision: input.action.kind,
    count: done,
  });

  const verb = input.action.kind === "verify" ? "ยืนยัน" : "ตีกลับ";
  const scope = targets.length > 1 ? ` ${done}/${targets.length} ไฟล์` : "";
  return {
    ok: true,
    message: `${verb}แล้ว${scope} โดย ${actor.displayName}${
      firstError ? ` (บางไฟล์ไม่สำเร็จ: ${firstError})` : ""
    }`,
  };
}

import { writeAudit } from "@/lib/audit";
import { promotionStatus, type PromotionStatus } from "@/lib/agents/commission";
import { prisma } from "@/lib/db";
import { todayInBangkok } from "@/lib/draws/range";
import { logger } from "@/lib/logger";
import { isChannelConfigured, sendToChannel } from "./channels";

/**
 * เตือนก่อนโปรโมชั่นค่าคอมหมดอายุ
 *
 * โปรโมชั่นที่หมดเงียบ ๆ ทำให้อัตราคอมกลับไปเป็นปกติโดยไม่มีใครรู้ แล้วเรื่องจะมาโผล่
 * ตอนรอบจ่ายค่าคอมในรูปของ Agent ที่ทักมาถามว่าทำไมได้น้อยลง ซึ่งตอนนั้นสายไปแล้ว
 * เพราะงวดที่ผ่านมาปิดบัญชีด้วยเรตปกติไปเรียบร้อย
 *
 * เตือนสองจังหวะที่ตัดสินใจได้ต่างกัน
 *   - ก่อนหมด ยังต่ออายุทันก่อนงวดถัดไป
 *   - วันที่หมดพอดี ให้รู้ว่าตั้งแต่งวดถัดไปกลับไปใช้เรตปกติแล้ว
 *
 * กันส่งซ้ำด้วย AuditEvent เหมือนงานแจ้งเตือนอื่นในระบบ โดยใช้คีย์เป็น
 * agentId + วันสิ้นสุด + จังหวะที่เตือน เรียก job ถี่แค่ไหนก็ได้ข้อความชุดเดียว
 * และถ้าแก้วันสิ้นสุดใหม่ คีย์เปลี่ยน จึงเตือนให้อีกครั้งอย่างถูกต้อง
 */

const ENTITY_TYPE = "AgentCommissionPromotion";

/** เตือนล่วงหน้ากี่วันก่อนหมด เลือก 3 วันเพราะหวยรัฐบาลห่างกันครึ่งเดือน ยังต่ออายุทันงวดถัดไป */
const WARN_DAYS_BEFORE = 3;

/** กันข้อความยาวเกินในรอบเดียว ที่เหลือรอรอบถัดไป */
const MAX_PER_RUN = 30;

export type PromotionExpiryOutcome = {
  /** จำนวนที่เข้าเกณฑ์ต้องเตือน ณ ตอนเริ่มรอบนี้ */
  due: number;
  /** จำนวนที่แจ้งสำเร็จและบันทึกกันส่งซ้ำแล้ว */
  notified: number;
  skippedReason?: "NOT_CONFIGURED" | "NOTHING_TO_SEND" | "SEND_FAILED";
  detail?: string;
};

type Stage = "BEFORE" | "LAST_DAY";

type DueRow = {
  organizationId: string;
  agentId: string;
  code: string;
  name: string;
  stage: Stage;
  status: PromotionStatus;
  auditKey: string;
};

function appUrl(path: string): string {
  const base = (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

function targetLine(status: PromotionStatus): string {
  const parts: string[] = [];
  if (status.thai) parts.push(`หวยรัฐบาล ${status.thai.minGross.toFixed(0)} → ${status.thai.rate.toFixed(2)}%`);
  if (status.lao) parts.push(`หวยลาว Family ${status.lao.minGross.toFixed(0)} → ${status.lao.rate.toFixed(2)}%`);
  return parts.join(" · ");
}

function buildMessage(rows: DueRow[], today: string): string {
  const ending = rows.filter((row) => row.stage === "BEFORE");
  const lastDay = rows.filter((row) => row.stage === "LAST_DAY");
  const lines = [`⏳ โปรโมชั่นค่าคอมใกล้หมดอายุ (${today})`, ""];

  if (lastDay.length > 0) {
    lines.push(`วันนี้เป็นวันสุดท้าย ${lastDay.length} ราย`);
    for (const row of lastDay) {
      lines.push(`• ${row.code} ${row.name} — ${targetLine(row.status)}`);
    }
    lines.push("");
  }
  if (ending.length > 0) {
    lines.push(`ใกล้หมดภายใน ${WARN_DAYS_BEFORE} วัน`);
    for (const row of ending) {
      lines.push(`• ${row.code} ${row.name} — เหลือ ${row.status.daysLeft} วัน ถึง ${row.status.endsOn}`);
    }
    lines.push("");
  }
  lines.push("ไม่ต่ออายุ = งวดถัดไปกลับไปใช้อัตราปกติ");
  lines.push(appUrl("/users/promotions"));
  return lines.join("\n");
}

/**
 * ตรวจและส่งเตือนโปรโมชั่นที่ใกล้หมด
 *
 * อ่าน Agent ทุกองค์กรที่ตั้งช่วงโปรโมชั่นไว้ แล้วค่อยกรองด้วย promotionStatus
 * ตัวเดียวกับที่หน้าจอใช้ เพื่อให้สิ่งที่เตือนตรงกับสิ่งที่ Owner เห็นเสมอ
 */
export async function runPromotionExpiryAlerts(now: Date = new Date()): Promise<PromotionExpiryOutcome> {
  if (!isChannelConfigured("daily-summary")) {
    return { due: 0, notified: 0, skippedReason: "NOT_CONFIGURED" };
  }

  const today = todayInBangkok(now);
  const agents = await prisma.agent.findMany({
    where: {
      status: { not: "CLOSED" },
      commissionPromotionStartsOn: { not: null },
      commissionPromotionEndsOn: { not: null },
    },
    orderBy: { code: "asc" },
    select: {
      id: true,
      organizationId: true,
      code: true,
      name: true,
      commissionRate: true,
      laoCommissionRate: true,
      commissionPromotionStartsOn: true,
      commissionPromotionEndsOn: true,
      commissionPromotionThaiMinGross: true,
      commissionPromotionLaoMinGross: true,
      commissionPromotionThaiRate: true,
      commissionPromotionLaoRate: true,
    },
  });

  const candidates: DueRow[] = [];
  for (const agent of agents) {
    const status = promotionStatus(agent, today, WARN_DAYS_BEFORE);
    if (status.state !== "ENDING_SOON") continue;
    const stage: Stage = status.daysLeft === 0 ? "LAST_DAY" : "BEFORE";
    candidates.push({
      organizationId: agent.organizationId,
      agentId: agent.id,
      code: agent.code,
      name: agent.name,
      stage,
      status,
      auditKey: `${agent.id}:${status.endsOn}:${stage}`,
    });
  }
  if (candidates.length === 0) return { due: 0, notified: 0, skippedReason: "NOTHING_TO_SEND" };

  const alreadySent = await prisma.auditEvent.findMany({
    where: {
      action: "NOTIFICATION_SENT",
      entityType: ENTITY_TYPE,
      entityId: { in: candidates.map((row) => row.auditKey) },
    },
    select: { entityId: true },
  });
  const sentKeys = new Set(alreadySent.map((row) => row.entityId));
  const due = candidates.filter((row) => !sentKeys.has(row.auditKey));
  if (due.length === 0) return { due: 0, notified: 0, skippedReason: "NOTHING_TO_SEND" };

  const batch = due.slice(0, MAX_PER_RUN);
  const result = await sendToChannel("daily-summary", buildMessage(batch, today));
  if (!result.ok) {
    logger.warn("promotion expiry alert failed", { reason: result.reason });
    return { due: due.length, notified: 0, skippedReason: "SEND_FAILED", detail: result.detail };
  }

  /*
   * บันทึกกันส่งซ้ำหลังส่งสำเร็จเท่านั้น
   *
   * ถ้าบันทึกก่อนแล้วการส่งล้ม จะไม่มีใครได้รับการเตือนเลยและไม่มีรอบไหนแก้ให้ได้อีก
   * ส่วนทางกลับกันแย่กว่านั้นไม่มาก คือได้ข้อความซ้ำเมื่อระบบล่มกลางคัน
   */
  for (const row of batch) {
    await writeAudit(prisma, {
      organizationId: row.organizationId,
      actorId: null,
      action: "NOTIFICATION_SENT",
      entityType: ENTITY_TYPE,
      entityId: row.auditKey,
      after: { channel: "daily-summary", agentCode: row.code, endsOn: row.status.endsOn, stage: row.stage },
      reason: "แจ้งเตือนโปรโมชั่นค่าคอมใกล้หมดอายุ",
    });
  }

  logger.info("promotion expiry alert sent", { count: batch.length });
  return { due: due.length, notified: batch.length };
}

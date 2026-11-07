import type { Actor } from "@/lib/auth/context";
import { writeAudit } from "@/lib/audit";
import { buildOwnerAnalytics } from "@/lib/chat/analytics";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { drawSummary } from "@/lib/reports/service";
import { sendToChannel } from "./channels";

/**
 * สรุปรายวันส่งเข้า Telegram
 *
 * ตัวเลขทุกตัวมาจาก drawSummary และ analytics ตัวเดียวกับที่หน้าจอใช้
 * ไม่ query เอง เพราะถ้าตัวเลขในแชทไม่ตรงกับ Dashboard ผู้รับจะไม่เชื่อทั้งสองที่
 * และต้องเข้าไปนั่งกระทบยอดเองทุกวัน ซึ่งทำให้สรุปรายวันไร้ประโยชน์
 *
 * กันส่งซ้ำด้วย AuditEvent โดยใช้วันที่เป็นตัวระบุ เรียกกี่ครั้งต่อวันก็ส่งครั้งเดียว
 * จึงตั้ง scheduler ให้เรียกถี่ได้โดยไม่ต้องคำนวณเวลาให้แม่น
 */

const ENTITY_TYPE = "DailySummary";

export type DailySummaryOutcome = {
  sent: boolean;
  /** วันที่ของสรุปในเขตเวลาขององค์กร รูปแบบ YYYY-MM-DD */
  date?: string;
  skippedReason?: "ALREADY_SENT" | "NO_ORGANIZATION" | "NO_OWNER" | "SEND_FAILED";
  detail?: string;
};

/** วันที่ตามเขตเวลาขององค์กร ไม่ใช่ของเครื่องที่รัน job */
export function localDateKey(now: Date, timezone: string): string {
  // en-CA ให้รูปแบบ YYYY-MM-DD ซึ่งเรียงลำดับได้ตรงตัวและไม่กำกวมเรื่องวัน/เดือน
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

function money(value: { toFixed: (digits: number) => string }): string {
  return value.toFixed(2);
}

function appUrl(path: string): string {
  const base = (process.env.APP_BASE_URL?.trim() || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${path}`;
}

/**
 * ผู้ใช้ที่ใช้เป็นมุมมองในการอ่านข้อมูล
 *
 * ใช้ Owner จริงขององค์กร ไม่ใช่บัญชีสมมติ เพื่อให้ขอบเขตที่เห็นตรงกับ
 * สิ่งที่ Owner เห็นบนหน้าจอเป๊ะ ๆ และเพื่อให้ไม่มีเส้นทางอ่านข้อมูล
 * ที่ข้ามด่านสิทธิ์ปกติของระบบ
 */
async function ownerActorOf(organizationId: string): Promise<Actor | null> {
  const owner = await prisma.user.findFirst({
    where: { organizationId, role: "OWNER", status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, mustChangePassword: true },
  });
  if (!owner) return null;

  return {
    userId: owner.id,
    organizationId,
    role: "OWNER",
    displayName: owner.displayName,
    agentId: null,
    mustChangePassword: owner.mustChangePassword,
    requestId: undefined,
    ipAddress: undefined,
  };
}

function formatSummary(input: {
  organizationName: string;
  date: string;
  draw: Awaited<ReturnType<typeof drawSummary>> | null;
  analytics: Awaited<ReturnType<typeof buildOwnerAnalytics>>;
  pending: {
    evidenceReviews: number;
    settlementReviews: number;
    cancellationRequests: number;
    resultCorrections: number;
  };
  resultEntry: { approved: number; activePrizeTypes: number };
}): string {
  const lines = [`สรุปประจำวัน ${input.date} · ${input.organizationName}`, ""];

  if (input.draw) {
    const d = input.draw;
    lines.push(`รอบล่าสุด: ${d.drawName} (${d.drawStatus})`);
    lines.push(`  ยอดขาย ${money(d.gross)} บาท · ${d.billCount} บิล · ${d.itemCount} รายการ`);
    if (d.pendingSettlement) {
      lines.push("  ยังไม่ได้คำนวณ Settlement ยอดจ่ายและสุทธิจึงยังไม่สมบูรณ์");
    } else {
      lines.push(
        `  จ่ายรางวัล ${money(d.payout)} · คอม ${money(d.commission)} · สุทธิ ${money(d.net)} บาท`,
      );
    }
  } else {
    lines.push("ยังไม่มีรอบในระบบ");
  }

  lines.push("");
  lines.push(
    `ลงผลแล้ว ${input.resultEntry.approved}/${input.resultEntry.activePrizeTypes} ประเภทรางวัล`,
  );

  const pendingTotal =
    input.pending.evidenceReviews +
    input.pending.settlementReviews +
    input.pending.cancellationRequests +
    input.pending.resultCorrections;

  lines.push("");
  if (pendingTotal === 0) {
    lines.push("งานค้าง: ไม่มี");
  } else {
    lines.push(`งานค้าง ${pendingTotal} รายการ`);
    if (input.pending.evidenceReviews > 0) {
      lines.push(`  หลักฐานรอตรวจ ${input.pending.evidenceReviews}`);
    }
    if (input.pending.settlementReviews > 0) {
      lines.push(`  ยอดรอตรวจสอบ ${input.pending.settlementReviews}`);
    }
    if (input.pending.cancellationRequests > 0) {
      lines.push(`  คำขอยกเลิกบิล ${input.pending.cancellationRequests}`);
    }
    if (input.pending.resultCorrections > 0) {
      lines.push(`  คำขอแก้ผลรางวัล ${input.pending.resultCorrections}`);
    }
  }

  const risk = input.analytics.riskExposure;
  lines.push("");
  if (risk.hasExposure && risk.details[0]) {
    const top = risk.details[0];
    lines.push(`ความเสี่ยงสูงสุด: เลข ${top.number} (${top.prizeType})`);
    lines.push(`  ถ้าออกต้องจ่าย ${top.payoutIfWins} บาท · รับไว้รวม ${risk.totalStake} บาท`);
  } else {
    lines.push("ความเสี่ยง: ไม่มีภาระผูกพันค้างอยู่");
  }

  const trend = input.analytics.salesTrend;
  const latest = trend.details[trend.details.length - 1];
  if (latest?.changeFromPreviousPercent) {
    const change = Number(latest.changeFromPreviousPercent);
    lines.push("");
    lines.push(
      `ยอดขายรอบล่าสุดเทียบรอบก่อน ${change >= 0 ? "+" : ""}${latest.changeFromPreviousPercent}%`,
    );
  }

  lines.push("");
  lines.push(appUrl("/"));
  return lines.join("\n");
}

/**
 * ส่งสรุปของวันนี้ ถ้ายังไม่เคยส่ง
 *
 * ลำดับสำคัญเหมือนงานแจ้งเตือน: ส่งก่อน แล้วค่อยบันทึกว่าส่งแล้ว
 * ถ้าสลับ วันที่ส่งไม่ออกจะถูกมองว่าส่งแล้วและหายไปทั้งวัน
 */
export async function runDailySummary(now: Date = new Date()): Promise<DailySummaryOutcome> {
  const organization = await prisma.organization.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, timezone: true },
  });
  if (!organization) return { sent: false, skippedReason: "NO_ORGANIZATION" };

  const date = localDateKey(now, organization.timezone);

  const already = await prisma.auditEvent.findFirst({
    where: {
      organizationId: organization.id,
      action: "NOTIFICATION_SENT",
      entityType: ENTITY_TYPE,
      entityId: date,
    },
    select: { id: true },
  });
  if (already) return { sent: false, date, skippedReason: "ALREADY_SENT" };

  const actor = await ownerActorOf(organization.id);
  if (!actor) return { sent: false, date, skippedReason: "NO_OWNER" };

  const latestDraw = await prisma.draw.findFirst({
    where: { organizationId: organization.id },
    orderBy: [{ cutoffAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });

  const [draw, analytics, evidenceReviews, cancellationRequests, activePrizeTypes] =
    await Promise.all([
      latestDraw ? drawSummary(actor, latestDraw.id) : Promise.resolve(null),
      buildOwnerAnalytics(actor),
      prisma.billAttachment.count({
        where: { organizationId: organization.id, status: "PENDING", replacedBy: null },
      }),
      prisma.bill.count({
        where: {
          organizationId: organization.id,
          cancelRequestedAt: { not: null },
          cancelledAt: null,
        },
      }),
      prisma.prizeType.count({ where: { organizationId: organization.id, isActive: true } }),
    ]);

  const [settlementReviews, resultCorrections, approvedResults] = latestDraw
    ? await Promise.all([
        prisma.settlement.count({
          where: { organizationId: organization.id, drawId: latestDraw.id, status: "DRAFT" },
        }),
        prisma.result.count({
          where: {
            organizationId: organization.id,
            drawId: latestDraw.id,
            status: "DRAFT",
            version: { gt: 1 },
          },
        }),
        prisma.result
          .findMany({
            where: {
              organizationId: organization.id,
              drawId: latestDraw.id,
              status: "APPROVED",
            },
            select: { prizeTypeId: true },
            distinct: ["prizeTypeId"],
          })
          .then((rows) => rows.length),
      ])
    : [0, 0, 0];

  const message = formatSummary({
    organizationName: organization.name,
    date,
    draw,
    analytics,
    pending: { evidenceReviews, settlementReviews, cancellationRequests, resultCorrections },
    resultEntry: { approved: approvedResults, activePrizeTypes },
  });

  const result = await sendToChannel("daily-summary", message);
  if (!result.ok) {
    logger.warn("daily summary failed", { reason: result.reason });
    return { sent: false, date, skippedReason: "SEND_FAILED", detail: result.detail };
  }

  await writeAudit(prisma, {
    organizationId: organization.id,
    actorId: null,
    action: "NOTIFICATION_SENT",
    entityType: ENTITY_TYPE,
    entityId: date,
    after: { channel: "daily-summary", date },
    reason: "ส่งสรุปรายวันไปยัง Telegram",
  });

  logger.info("daily summary sent", { date });
  return { sent: true, date };
}

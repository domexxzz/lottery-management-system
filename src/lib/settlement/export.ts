import { prisma } from "@/lib/db";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { NotFoundError } from "@/lib/errors";

/**
 * ไฟล์สำหรับกระทบยอดด้วยมือ (LOT-22)
 *
 * ออกแบบให้เปิดใน Excel แล้วตรวจได้ทันที: หนึ่งบรรทัดคือหนึ่งรายการในบิล
 * พร้อมอัตราจ่ายที่ล็อกไว้และผลที่ออก เพื่อให้ไล่ย้อนได้ว่าทำไมรายการนี้
 * ถูกหรือไม่ถูกรางวัล โดยไม่ต้องเปิดฐานข้อมูล
 */

const COLUMNS = [
  "เลขบิล",
  "ชื่อบิล",
  "รหัส Agent",
  "ชื่อ Agent",
  "รหัสรางวัล",
  "ชื่อรางวัล",
  "วิธีตัดสิน",
  "เลขที่แทง",
  "ยอดเดิมพัน",
  "อัตราจ่ายที่ล็อกไว้",
  "ผลที่ออก",
  "ถูกรางวัล",
  "ยอดจ่าย",
] as const;

const MATCH_RULE_LABEL: Record<string, string> = {
  EXACT: "ตรงทุกหลัก",
  PERMUTATION: "โต๊ด",
  CONTAINS_DIGIT: "วิ่ง",
};

/** ครอบค่าให้ปลอดภัยสำหรับ CSV และกัน formula injection ใน Excel */
function csvCell(value: string): string {
  // ค่าที่ขึ้นต้นด้วยอักขระเหล่านี้ Excel จะตีความเป็นสูตร
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export async function reconciliationCsv(actor: Actor, drawId: string): Promise<string> {
  requirePermission(actor, "settlement.reconcile");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, name: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบรอบ");

  const [bills, results] = await Promise.all([
    prisma.bill.findMany({
      where: { drawId: draw.id, status: { in: ["LOCKED", "SETTLED"] } },
      orderBy: [{ agent: { code: "asc" } }, { billNumber: "asc" }],
      select: {
        billNumber: true,
        title: true,
        agent: { select: { code: true, name: true } },
        items: {
          orderBy: { createdAt: "asc" },
          select: {
            number: true,
            stake: true,
            payoutRateSnapshot: true,
            isWinner: true,
            payout: true,
            prizeTypeId: true,
            prizeType: { select: { code: true, name: true, matchRule: true } },
          },
        },
      },
    }),
    prisma.result.findMany({
      where: { drawId: draw.id, status: "APPROVED" },
      orderBy: { version: "desc" },
      select: { prizeTypeId: true, value: true },
    }),
  ]);

  const resultByPrizeType = new Map<string, string>();
  for (const r of results) {
    if (!resultByPrizeType.has(r.prizeTypeId)) resultByPrizeType.set(r.prizeTypeId, r.value);
  }

  const rows: string[] = [COLUMNS.map(csvCell).join(",")];

  for (const bill of bills) {
    for (const item of bill.items) {
      rows.push(
        [
          bill.billNumber ?? "",
          bill.title,
          bill.agent.code,
          bill.agent.name,
          String(item.prizeType.code),
          item.prizeType.name,
          MATCH_RULE_LABEL[item.prizeType.matchRule] ?? item.prizeType.matchRule,
          item.number,
          item.stake.toFixed(2),
          item.payoutRateSnapshot.toFixed(4),
          resultByPrizeType.get(item.prizeTypeId) ?? "ยังไม่มีผล",
          item.isWinner ? "ถูก" : "ไม่ถูก",
          item.payout.toFixed(2),
        ].map(csvCell).join(","),
      );
    }
  }

  // BOM ให้ Excel อ่านภาษาไทยไม่เพี้ยน
  return `﻿${rows.join("\r\n")}\r\n`;
}

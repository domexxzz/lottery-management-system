import { prisma } from "@/lib/db";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { NotFoundError } from "@/lib/errors";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import type { TableWorkbookCell } from "@/lib/excel/table-workbook";
import { laoSetPackageLabel } from "@/lib/lao/rules";

/**
 * ไฟล์สำหรับกระทบยอดด้วยมือ (LOT-22)
 *
 * ออกแบบให้เปิดใน Excel แล้วตรวจได้ทันที: หนึ่งบรรทัดคือหนึ่งรายการในบิล
 * พร้อมอัตราจ่ายที่ล็อกไว้และผลที่ออก เพื่อให้ไล่ย้อนได้ว่าทำไมรายการนี้
 * ถูกหรือไม่ถูกรางวัล โดยไม่ต้องเปิดฐานข้อมูล
 */

const COLUMNS = [
  "ประเภทหวย",
  "งวด",
  "เลขบิล",
  "ชื่อบิล",
  "รหัส Agent",
  "ชื่อ Agent",
  "รหัสรางวัล",
  "ชื่อรางวัล",
  "วิธีตัดสิน",
  "เลขที่แทง",
  "ยอดเดิมพัน (บาท)",
  "อัตราจ่ายที่ล็อกไว้",
  "ผลที่ออก",
  "ถูกรางวัล",
  "รางวัลที่เลือกจ่าย",
  "รางวัลที่ตรวจพบแต่ไม่จ่าย",
  "ยอดจ่าย (บาท)",
] as const;

const MATCH_RULE_LABEL: Record<string, string> = {
  EXACT: "ตรงทุกหลัก",
  PERMUTATION: "โต๊ด",
  CONTAINS_DIGIT: "วิ่ง",
};

export async function reconciliationExport(actor: Actor, drawId: string): Promise<{ rows: TableWorkbookCell[][]; filenameBase: string; title: string }> {
  requirePermission(actor, "settlement.reconcile");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, name: true, drawDate: true, lotteryType: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบรอบ");

  const [bills, results] = await Promise.all([
    prisma.bill.findMany({
      where: { drawId: draw.id, status: { in: ["LOCKED", "SETTLED"] } },
      orderBy: [{ agent: { code: "asc" } }, { drawSequence: "asc" }],
      select: {
        drawSequence: true,
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
            winningPrizes: {
              orderBy: [{ payout: "desc" }, { prizeKey: "asc" }],
              select: { prizeLabelSnapshot: true, payoutRateSnapshot: true, payout: true, isPaid: true },
            },
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

  const rows: TableWorkbookCell[][] = [];

  for (const bill of bills) {
    for (const item of bill.items) {
      const resultValue = resultByPrizeType.get(item.prizeTypeId);
      const isLaoSetEntry = draw.lotteryType === "LAO_SET" && item.prizeType.code === 201;
      const paidPrizeText = item.winningPrizes
        .filter((prize) => prize.isPaid)
        .map((prize) => `${prize.prizeLabelSnapshot} (${Number(prize.payout).toLocaleString("th-TH")} บาท)`)
        .join("; ");
      const suppressedPrizeText = item.winningPrizes
        .filter((prize) => !prize.isPaid)
        .map((prize) => `${prize.prizeLabelSnapshot} (${Number(prize.payout).toLocaleString("th-TH")} บาท)`)
        .join("; ");
      const winningRateText = item.winningPrizes
        .map((prize) => `${prize.prizeLabelSnapshot} × ${Number(prize.payoutRateSnapshot).toLocaleString("th-TH", { maximumFractionDigits: 4 })}`)
        .join("; ");
      rows.push([
          lotteryLabel(draw.lotteryType),
          drawDateLabel(draw),
          visibleBillNumber(bill.drawSequence),
          bill.title,
          bill.agent.code,
          bill.agent.name,
          String(item.prizeType.code),
          item.prizeType.name,
          isLaoSetEntry ? "ตรวจ 8 รางวัล เลือกจ่ายรางวัลสูงสุด 1 รางวัลต่อรายการ" : MATCH_RULE_LABEL[item.prizeType.matchRule] ?? item.prizeType.matchRule,
          item.number,
          Number(item.stake),
          isLaoSetEntry
            ? winningRateText
              ? winningRateText
              : `ตามตาราง ${laoSetPackageLabel(item.stake) ?? ""}`.trim()
            : Number(item.payoutRateSnapshot),
          resultValue ?? "ยังไม่มีผล",
          resultValue === undefined ? "รอผล" : item.isWinner ? "ถูก" : "ไม่ถูก",
          paidPrizeText || "-",
          suppressedPrizeText || "-",
          Number(item.payout),
        ]);
    }
  }

  const title = `${lotteryLabel(draw.lotteryType)} งวด ${drawDateLabel(draw)}`;
  return { rows, title, filenameBase: `กระทบยอด_${lotteryLabel(draw.lotteryType)}_${drawDateLabel(draw)}` };
}

export { COLUMNS as RECONCILIATION_COLUMNS };

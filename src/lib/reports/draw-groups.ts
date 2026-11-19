import type { DrawStatus, LotteryType } from "@prisma/client";

export const REPORT_LOTTERIES = ["THAI_GOVERNMENT", "LAO", "LAO_SET"] as const;
export type ReportLotteryType = (typeof REPORT_LOTTERIES)[number];
export type ReportLottery = readonly ReportLotteryType[];
export type ReportCategory = "THAI_GOVERNMENT" | "LAO_COMBINED";

export type PhysicalReportDraw = {
  id: string;
  name: string;
  drawDate: Date | null;
  cutoffAt: Date;
  status: DrawStatus;
  lotteryType: LotteryType;
  laoFamilyId: string | null;
};

export type LogicalReportDraw = PhysicalReportDraw & {
  category: ReportCategory;
  memberIds: string[];
  allSettled: boolean;
};

export const isLaoLottery = (lotteryType: string) => lotteryType === "LAO" || lotteryType === "LAO_SET";
export const reportCategoryOf = (lotteryType: string): ReportCategory => isLaoLottery(lotteryType) ? "LAO_COMBINED" : "THAI_GOVERNMENT";
export const reportCategoryLabel = (category: ReportCategory) => category === "LAO_COMBINED" ? "หวยลาวและหวยลาวชุด" : "หวยรัฐบาล";

export const isAllReportLotteries = (lotteries: ReportLottery) => lotteries.length === REPORT_LOTTERIES.length;

/**
 * หน้ารายงานมีเพียง 2 หมวดธุรกิจ: รัฐบาล และลาวรวมชุด
 * URL เก่าที่เลือก LAO หรือ LAO_SET เพียงตัวเดียวจึงถูกปรับเป็นคู่โดยอัตโนมัติ
 */
export function normalizeReportLotteries(requested: readonly string[]): ReportLotteryType[] {
  const thai = requested.includes("THAI_GOVERNMENT");
  const lao = requested.some(isLaoLottery);
  if ((!thai && !lao) || (thai && lao)) return [...REPORT_LOTTERIES];
  return thai ? ["THAI_GOVERNMENT"] : ["LAO", "LAO_SET"];
}

/** รวมงวดลาวและลาวชุดที่มี laoFamilyId เดียวกันให้เป็นหนึ่งงวดสำหรับรายงานเท่านั้น */
export function groupReportDraws<T extends PhysicalReportDraw>(draws: readonly T[]): LogicalReportDraw[] {
  const groups = new Map<string, T[]>();
  for (const draw of draws) {
    const key = isLaoLottery(draw.lotteryType) && draw.laoFamilyId ? `lao:${draw.laoFamilyId}` : `draw:${draw.id}`;
    const rows = groups.get(key) ?? [];
    rows.push(draw);
    groups.set(key, rows);
  }

  return [...groups.values()].map((members) => {
    const representative = members.find((draw) => draw.lotteryType === "LAO") ?? members[0]!;
    return {
      ...representative,
      category: reportCategoryOf(representative.lotteryType),
      memberIds: members.map((draw) => draw.id),
      allSettled: members.every((draw) => draw.status === "SETTLED" || draw.status === "CLOSED"),
    };
  }).sort((a, b) => b.cutoffAt.getTime() - a.cutoffAt.getTime());
}

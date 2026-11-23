import type { DrawStatus, LotteryType } from "@prisma/client";
import { groupReportDraws, type LogicalReportDraw, type ReportCategory } from "@/lib/reports/draw-groups";

export type DashboardLotteryCategory = "ALL" | ReportCategory;

export type DashboardPhysicalDraw = {
  id: string;
  name: string;
  drawDate: Date | null;
  cutoffAt: Date;
  status: DrawStatus;
  lotteryType: LotteryType;
  laoFamilyId: string | null;
};

export type DashboardDrawScope = {
  category: DashboardLotteryCategory;
  logicalDraws: LogicalReportDraw[];
  selectedDraw: LogicalReportDraw | null;
  /** undefined = ทุกงวด, [] = ไม่มีงวดที่เข้าเงื่อนไข */
  drawIds: string[] | undefined;
};

const THAI_DRAW_DAY = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" });

export function dashboardDrawLabel(draw: Pick<DashboardPhysicalDraw, "drawDate" | "name">): string {
  return draw.drawDate ? THAI_DRAW_DAY.format(draw.drawDate) : draw.name.replace(/^งวด\s*/, "");
}

export function parseDashboardLotteryCategory(value: string | null | undefined): DashboardLotteryCategory {
  if (value === "THAI_GOVERNMENT") return "THAI_GOVERNMENT";
  if (value === "LAO_COMBINED" || value === "LAO" || value === "LAO_SET") return "LAO_COMBINED";
  return "ALL";
}

export function drawMatchesDashboardCategory(draw: Pick<DashboardPhysicalDraw, "lotteryType">, category: DashboardLotteryCategory): boolean {
  if (category === "ALL") return true;
  return category === "THAI_GOVERNMENT"
    ? draw.lotteryType === "THAI_GOVERNMENT"
    : draw.lotteryType === "LAO" || draw.lotteryType === "LAO_SET";
}

/**
 * แปลงงวดจริงเป็นงวดที่ผู้ใช้เห็นในหน้าภาพรวม
 * หวยลาวและหวยลาวชุดที่มี laoFamilyId เดียวกันจะถูกเลือกและคำนวณพร้อมกันเสมอ
 */
export function resolveDashboardDrawScope(
  draws: readonly DashboardPhysicalDraw[],
  lottery: string | null | undefined,
  drawId: string | null | undefined,
): DashboardDrawScope {
  const logicalDraws = groupReportDraws(draws);
  const requestedCategory = parseDashboardLotteryCategory(lottery);
  const selectedDraw = drawId
    ? logicalDraws.find((draw) => draw.id === drawId || draw.memberIds.includes(drawId)) ?? null
    : null;
  // URL เก่าที่มี drawId แต่ไม่มีประเภท ยังต้องเปิดงวดนั้นได้ถูกหมวด
  const category = selectedDraw ? selectedDraw.category : requestedCategory;
  const drawIds = selectedDraw
    ? selectedDraw.memberIds
    : category === "ALL"
      ? undefined
      : draws.filter((draw) => drawMatchesDashboardCategory(draw, category)).map((draw) => draw.id);

  return { category, logicalDraws, selectedDraw, drawIds };
}


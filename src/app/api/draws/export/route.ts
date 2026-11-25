import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { listDraws } from "@/lib/draws/service";
import { DRAW_DISPLAY_STATUS_LABEL, getDrawDisplayStatus } from "@/lib/draws/display-status";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";
import { apiError } from "@/lib/http";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { drawDay, inRange, parseDay, thaiDayLabel } from "@/lib/draws/range";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";

export const dynamic = "force-dynamic";

const LOTTERY_LABEL: Record<string, string> = {
  THAI_GOVERNMENT: "หวยรัฐบาล",
  LAO: "หวยลาว",
  LAO_SET: "หวยลาวชุด",
};

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  try {
    const params = new URL(request.url).searchParams;
    const query = (params.get("q") ?? "").trim().toLocaleLowerCase("th-TH");
    const requestedStatus = params.get("status") ?? "";
    const status = requestedStatus === "OPEN" || requestedStatus === "CLOSED" || requestedStatus === "CHECKED" ? requestedStatus : "";
    const allDraws = await listDraws(actor, null, "opensAt");
    const drawScope = resolveDashboardDrawScope(allDraws, params.get("lottery"), params.get("drawId"));
    const dateFrom = parseDay(params.get("dateFrom"));
    const dateTo = parseDay(params.get("dateTo"));
    const draws = allDraws.filter((draw) => (
      (!query || draw.name.toLocaleLowerCase("th-TH").includes(query))
      && (drawScope.drawIds === undefined || drawScope.drawIds.includes(draw.id))
      && inRange(drawDay(draw), dateFrom, dateTo)
      && (!status || getDrawDisplayStatus(draw) === status)
    ));
    const countStatus = (value: "OPEN" | "CLOSED" | "CHECKED") => draws.filter((draw) => getDrawDisplayStatus(draw) === value).length;
    const report: ReportExportInput = {
      filename: "draws",
      title: "รายการงวด",
      subtitle: "รายการงวดตามตัวกรองบนหน้าจอ เรียงจากวันเปิดรับล่าสุด",
      sheetName: "รายการงวด",
      metadata: [
        { label: "คำค้น", value: query || "ทั้งหมด" },
        { label: "ประเภทหวย", value: drawScope.category === "ALL" ? "ทุกประเภท" : reportCategoryLabel(drawScope.category) },
        { label: "งวดที่เลือก", value: drawScope.selectedDraw ? dashboardDrawLabel(drawScope.selectedDraw) : "รวมทุกงวด" },
        { label: "วันที่เริ่มต้น", value: dateFrom ? thaiDayLabel(dateFrom) : "ไม่จำกัด" },
        { label: "วันที่สิ้นสุด", value: dateTo ? thaiDayLabel(dateTo) : "ไม่จำกัด" },
        { label: "สถานะที่เลือก", value: status ? DRAW_DISPLAY_STATUS_LABEL[status] : "ทุกสถานะ" },
      ],
      summary: [
        { label: "จำนวนงวดทั้งหมด", value: draws.length, type: "integer", unit: "งวด" },
        { label: "เปิดรับ", value: countStatus("OPEN"), type: "integer", unit: "งวด" },
        { label: "ปิดรับ", value: countStatus("CLOSED"), type: "integer", unit: "งวด" },
        { label: "ตรวจผลแล้ว", value: countStatus("CHECKED"), type: "integer", unit: "งวด" },
      ],
      columns: [
        { header: "วันที่ออกรางวัล", type: "date", width: 17 }, { header: "ประเภทหวย", width: 18 },
        { header: "ชื่องวด", width: 28 }, { header: "สถานะ", width: 15 }, { header: "เปิดรับ", type: "datetime", width: 20 },
        { header: "ปิดรับ", type: "datetime", width: 20 }, { header: "ล็อกเมื่อ", type: "datetime", width: 20 },
        { header: "จำนวนบิล", type: "integer", width: 13 }, { header: "ผลรางวัลที่กรอก", type: "integer", width: 17 },
        { header: "สร้างเมื่อ", type: "datetime", width: 20 },
      ],
      rows: draws.map((draw) => [
        draw.drawDate ?? draw.cutoffAt,
        LOTTERY_LABEL[draw.lotteryType] ?? draw.lotteryType,
        draw.name,
        DRAW_DISPLAY_STATUS_LABEL[getDrawDisplayStatus(draw)],
        draw.opensAt,
        draw.cutoffAt,
        draw.lockedAt,
        draw._count.bills,
        draw._count.results,
        draw.createdAt,
      ]),
    };
    const output = createReportDownload(report, "xlsx");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    return apiError(error);
  }
}

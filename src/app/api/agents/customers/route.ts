import { NextResponse } from "next/server";
import { getActor, orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { listOrganizationCustomers } from "@/lib/agents/customers";
import { AppError } from "@/lib/errors";
import { drawDay, inRange, parseDay } from "@/lib/draws/range";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";
import { dashboardDrawLabel, drawMatchesDashboardCategory, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = parseDay(params.get("from"));
  const to = parseDay(params.get("to"));
  const drawId = params.get("draw") || undefined;
  const lottery = params.get("lottery");
  try {
    const physicalDraws = await prisma.draw.findMany({
      where: orgScope(actor),
      orderBy: { cutoffAt: "desc" },
      select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true, laoFamilyId: true },
    });
    const drawScope = resolveDashboardDrawScope(physicalDraws, lottery, drawId);
    // ช่วงวันที่มาก่อนงวดเดียว ให้ตรงกับที่หน้าภาพรวม Agent แสดง
    const draws = from || to
      ? physicalDraws.filter((draw) => drawMatchesDashboardCategory(draw, drawScope.category) && inRange(drawDay(draw), from, to)).map((draw) => draw.id)
      : drawScope.drawIds;
    const scopeLabel = from || to
      ? `${from ?? "เริ่มต้น"} ถึง ${to ?? "ปัจจุบัน"}`
      : drawScope.selectedDraw
        ? `${reportCategoryLabel(drawScope.selectedDraw.category)} · ${dashboardDrawLabel(drawScope.selectedDraw)}`
        : drawScope.category === "ALL" ? "ทุกประเภท · ทุกงวด" : `${reportCategoryLabel(drawScope.category)} · ทุกงวด`;
    const customers = await listOrganizationCustomers(actor, draws);
    const report: ReportExportInput = {
      filename: `customers_${from || "all"}_${to || from || "all"}`,
      title: "รายชื่อลูกค้าทุก Agent",
      subtitle: `ขอบเขตข้อมูล: ${scopeLabel}`,
      sheetName: "Details",
      metadata: [{ label: "ขอบเขตข้อมูล", value: scopeLabel }],
      summary: [
        { label: "จำนวนลูกค้า", value: customers.length, type: "integer", unit: "ราย" },
        { label: "จำนวนบิล", value: customers.reduce((sum, customer) => sum + customer.billCount, 0), type: "integer", unit: "บิล" },
        { label: "ยอดซื้อรวม", value: customers.reduce((sum, customer) => sum + customer.gross, 0), type: "money", unit: "บาท" },
        { label: "จ่ายรางวัลรวม", value: customers.reduce((sum, customer) => sum + customer.payout, 0), type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "ขอบเขตข้อมูล", type: "text", width: 26 }, { header: "รหัส Agent", type: "text", width: 14 },
        { header: "ชื่อ Agent", type: "text", width: 25 }, { header: "ชื่อลูกค้า", type: "text", width: 25 },
        { header: "จำนวนบิล", type: "integer", width: 15 }, { header: "ยอดซื้อรวม", type: "money", width: 18 },
        { header: "จ่ายรางวัล", type: "money", width: 18 }, { header: "ทำรายการล่าสุด", type: "datetime", width: 20 },
      ],
      rows: customers.map((customer) => [scopeLabel, customer.agentCode, customer.agentName, customer.name, customer.billCount, customer.gross, customer.payout, customer.lastBillAt]),
    };
    const output = createReportDownload(report, params.get("format") === "xlsx" ? "xlsx" : "csv");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

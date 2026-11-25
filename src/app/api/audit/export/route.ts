import { NextResponse } from "next/server";
import type { Prisma, ResultStatus } from "@prisma/client";
import { getActor, orgScope, requirePermission } from "@/lib/auth/context";
import { auditDateRange, auditDrawWhere } from "@/lib/audit/history";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { statusLabel } from "@/lib/bills/lifecycle";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { prisma } from "@/lib/db";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";
import { apiError } from "@/lib/http";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";

export const dynamic = "force-dynamic";

const RESULT_LABEL: Record<ResultStatus, string> = { DRAFT: "รอตรวจ", APPROVED: "ตรวจแล้ว", REJECTED: "ตีกลับ" };

function scopeLabel(scope: ReturnType<typeof resolveDashboardDrawScope>) {
  if (scope.selectedDraw) return `${reportCategoryLabel(scope.selectedDraw.category)} · ${dashboardDrawLabel(scope.selectedDraw)}`;
  return scope.category === "ALL" ? "ทุกประเภท · ทุกงวด" : `${reportCategoryLabel(scope.category)} · ทุกงวด`;
}

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  try {
    requirePermission(actor, "audit.viewAll");
    const params = new URL(request.url).searchParams;
    const view = params.get("view") === "bills" ? "bills" : "results";
    const dates = auditDateRange(params.get("dateFrom"), params.get("dateTo"));
    const organizationScope = orgScope(actor);
    const draws = await prisma.draw.findMany({
      where: organizationScope,
      orderBy: { cutoffAt: "desc" },
      select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true, laoFamilyId: true },
    });
    const drawScope = resolveDashboardDrawScope(draws, params.get("lottery"), params.get("drawId"));
    const metadata = [
      { label: "ขอบเขตงวด", value: scopeLabel(drawScope) },
      { label: "ตั้งแต่วันที่", value: dates.fromDay ?? "เริ่มต้น" },
      { label: "ถึงวันที่", value: dates.toDay ?? "ล่าสุด" },
      { label: "มุมมอง", value: view === "results" ? "ประวัติผลรางวัลที่กรอก" : "บิลและเลขที่คีย์" },
    ];

    if (view === "results") {
      const where: Prisma.ResultWhereInput = {
        ...organizationScope,
        ...auditDrawWhere(drawScope.drawIds),
        ...(dates.from || dates.to ? { enteredAt: { ...(dates.from ? { gte: dates.from } : {}), ...(dates.to ? { lte: dates.to } : {}) } } : {}),
      };
      const results = await prisma.result.findMany({
        where,
        orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
        select: {
          value: true, version: true, status: true, enteredAt: true, checkedAt: true, rejectReason: true,
          draw: { select: { name: true } },
          prizeType: { select: { code: true, name: true, digits: true } },
          maker: { select: { displayName: true } },
          checker: { select: { displayName: true } },
        },
      });
      const report: ReportExportInput = {
        filename: `audit-results_${dates.fromDay ?? "all"}_${dates.toDay ?? "latest"}`,
        title: "ประวัติผลรางวัลที่กรอก",
        subtitle: "ข้อมูลทั้งหมดตามตัวกรองบนหน้าประวัติการตรวจผลรางวัล",
        sheetName: "Result History",
        metadata,
        summary: [
          { label: "ผลรางวัลทั้งหมด", value: results.length, type: "integer", unit: "รายการ" },
          { label: "ตรวจแล้ว", value: results.filter((row) => row.status === "APPROVED").length, type: "integer", unit: "รายการ" },
          { label: "รอตรวจ", value: results.filter((row) => row.status === "DRAFT").length, type: "integer", unit: "รายการ" },
          { label: "ตีกลับ", value: results.filter((row) => row.status === "REJECTED").length, type: "integer", unit: "รายการ" },
        ],
        columns: [
          { header: "งวด", width: 28 }, { header: "รหัสประเภทรางวัล", width: 18 }, { header: "ประเภทรางวัล", width: 24 },
          { header: "ผลรางวัล", width: 16 }, { header: "จำนวนหลัก", type: "integer" }, { header: "เวอร์ชัน", type: "integer" },
          { header: "ผู้บันทึก", width: 20 }, { header: "เวลาที่บันทึก", type: "datetime" }, { header: "สถานะ", width: 14 },
          { header: "ผู้ยืนยัน", width: 20 }, { header: "เวลาที่ยืนยัน", type: "datetime" }, { header: "เหตุผลตีกลับ", width: 32 },
        ],
        rows: results.map((result) => [
          result.draw.name, result.prizeType.code, result.prizeType.name, result.value, result.prizeType.digits, result.version,
          result.maker.displayName, result.enteredAt, RESULT_LABEL[result.status], result.checker?.displayName ?? "",
          result.checkedAt, result.rejectReason ?? "",
        ]),
      };
      const output = createReportDownload(report, "xlsx");
      return new NextResponse(output.body, { headers: output.headers });
    }

    const where: Prisma.BillWhereInput = {
      ...organizationScope,
      ...auditDrawWhere(drawScope.drawIds),
      ...(dates.from || dates.to ? { createdAt: { ...(dates.from ? { gte: dates.from } : {}), ...(dates.to ? { lte: dates.to } : {}) } } : {}),
    };
    const bills = await prisma.bill.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        drawSequence: true, title: true, status: true, createdAt: true, totalStake: true,
        draw: { select: { name: true } }, agent: { select: { code: true } }, createdBy: { select: { displayName: true } },
        items: {
          orderBy: { createdAt: "asc" },
          select: { number: true, stake: true, payoutRateSnapshot: true, prizeType: { select: { code: true, name: true, digits: true } } },
        },
      },
    });
    const report: ReportExportInput = {
      filename: `audit-bills_${dates.fromDay ?? "all"}_${dates.toDay ?? "latest"}`,
      title: "บิลและเลขที่คีย์",
      subtitle: "ข้อมูลทั้งหมดตามตัวกรองบนหน้าประวัติการตรวจผลรางวัล",
      sheetName: "Bill Keying History",
      metadata,
      summary: [
        { label: "จำนวนบิล", value: bills.length, type: "integer", unit: "บิล" },
        { label: "จำนวนรายการเลข", value: bills.reduce((sum, bill) => sum + bill.items.length, 0), type: "integer", unit: "รายการ" },
        { label: "ยอดเดิมพันรวม", value: bills.reduce((sum, bill) => sum + Number(bill.totalStake), 0), type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "เลขบิล", width: 16 }, { header: "ลูกค้า", width: 24 }, { header: "งวด", width: 28 }, { header: "Agent", width: 12 },
        { header: "ผู้กรอก", width: 20 }, { header: "เวลาที่คีย์", type: "datetime" }, { header: "สถานะบิล", width: 16 },
        { header: "รหัสประเภทรางวัล", width: 18 }, { header: "ประเภทรางวัล", width: 24 }, { header: "เลขที่คีย์", width: 16 },
        { header: "จำนวนหลัก", type: "integer" }, { header: "ยอดเดิมพัน", type: "money" }, { header: "อัตราจ่าย Snapshot", type: "decimal" },
      ],
      rows: bills.flatMap((bill) => bill.items.map((item) => [
        visibleBillNumber(bill.drawSequence), bill.title, bill.draw.name, bill.agent.code, bill.createdBy.displayName,
        bill.createdAt, statusLabel(bill.status), item.prizeType.code, item.prizeType.name, item.number,
        item.prizeType.digits, Number(item.stake), bill.status === "DRAFT" ? null : Number(item.payoutRateSnapshot),
      ])),
    };
    const output = createReportDownload(report, "xlsx");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    return apiError(error);
  }
}

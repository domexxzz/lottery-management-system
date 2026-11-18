import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { getAgentReport } from "@/lib/reports/agent-report";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { type TableWorkbookInput } from "@/lib/excel/table-workbook";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { PENDING: "รอ Settlement", DRAFT: "คำนวณแล้ว", RECONCILED: "ตรวจสอบยอดแล้ว", APPROVED: "อนุมัติแล้ว" };
const BILL_STATUS: Record<string, string> = {
  DRAFT: "รอยืนยัน",
  CONFIRMED: "กำลังแทง",
  LOCKED: "รอผลรางวัล",
  SETTLED: "ตรวจผลแล้ว",
  CANCELLED: "ยกเลิก",
};

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const params = new URL(request.url).searchParams;

  try {
    const report = await getAgentReport(actor, {
      drawId: params.get("draw") ?? undefined,
      dateFrom: params.get("dateFrom") ?? undefined,
      dateTo: params.get("dateTo") ?? undefined,
      settlement: params.get("settlement") ?? undefined,
      view: params.get("view") ?? undefined,
    });

    let name: string;
    let workbook: TableWorkbookInput;
    if (report.selectedView === "prizes") {
      name = `agent-prizes_${report.agent.code}`;
      workbook = {
        title: `รายงานประเภทรางวัล ${report.agent.code} · ${report.agent.name}`,
        sheetName: "ประเภทรางวัล",
        columns: [{ header: "รหัสรางวัล", type: "text" }, { header: "ประเภทรางวัล", type: "text", width: 25 }, { header: "จำนวนรายการเลข (รายการ)", type: "integer", width: 23 }, { header: "ถูกรางวัล (รายการ)", type: "integer", width: 20 }, { header: "ยอดขาย (บาท)", type: "money" }, { header: "จ่ายรางวัล (บาท)", type: "money" }],
        rows: report.prizes.map((row) => [String(row.code), row.name, row.count, row.winners, Number(row.gross), Number(row.payout)]),
      };
    } else if (report.selectedView === "bills" || report.selectedView === "winners") {
      name = `${report.selectedView === "winners" ? "agent-winning-bills" : "agent-bills"}_${report.agent.code}`;
      workbook = {
        title: `${report.selectedView === "winners" ? "บิลถูกรางวัล" : "รายการบิล"} ${report.agent.code} · ${report.agent.name}`,
        sheetName: report.selectedView === "winners" ? "บิลถูกรางวัล" : "รายการบิล",
        columns: [{ header: "เลขบิล", type: "text" }, { header: "ชื่อลูกค้า", type: "text", width: 25 }, { header: "งวด", type: "text", width: 28 }, { header: "จำนวนรายการเลข (รายการ)", type: "integer", width: 23 }, { header: "ยอดขาย (บาท)", type: "money" }, { header: "จ่ายรางวัล (บาท)", type: "money" }, { header: "วันที่สร้างบิล", type: "datetime", width: 20 }, { header: "สถานะ", type: "text", width: 16 }],
        rows: report.bills.map((bill) => [visibleBillNumber(bill.drawSequence), bill.title, bill.draw.name, bill._count.items, Number(bill.totalStake), Number(bill.totalPayout), bill.createdAt, BILL_STATUS[bill.status] ?? bill.status]),
      };
    } else if (report.selectedView === "settlements") {
      name = `agent-settlements_${report.agent.code}`;
      workbook = {
        title: `สรุปยอด ${report.agent.code} · ${report.agent.name}`,
        sheetName: "สรุปยอด",
        columns: [{ header: "งวด", type: "text", width: 28 }, { header: "วันที่ปิดรับ", type: "datetime", width: 20 }, { header: "ยอดขาย (บาท)", type: "money" }, { header: "จ่ายรางวัล (บาท)", type: "money" }, { header: "ค่าคอม (บาท)", type: "money" }, { header: "สุทธิ (บาท)", type: "money" }, { header: "สถานะ", type: "text", width: 18 }],
        rows: report.settlements.map((row) => [row.drawName, row.cutoffAt, Number(row.gross), Number(row.payout), row.commission === null ? null : Number(row.commission), row.net === null ? null : Number(row.net), STATUS[row.settlementStatus] ?? row.settlementStatus]),
      };
    } else {
      name = `agent-rounds_${report.agent.code}`;
      workbook = {
        title: `รายงานรายงวด ${report.agent.code} · ${report.agent.name}`,
        sheetName: "รายงานรายงวด",
        columns: [{ header: "งวด", type: "text", width: 28 }, { header: "วันที่ปิดรับ", type: "datetime", width: 20 }, { header: "จำนวนบิล (บิล)", type: "integer" }, { header: "จำนวนรายการเลข (รายการ)", type: "integer", width: 23 }, { header: "ยอดขาย (บาท)", type: "money" }, { header: "จ่ายรางวัล (บาท)", type: "money" }, { header: "ค่าคอม (บาท)", type: "money" }, { header: "สุทธิ (บาท)", type: "money" }, { header: "สถานะ", type: "text", width: 18 }],
        rows: report.rows.map((row) => [row.drawName, row.cutoffAt, row.billCount, row.itemCount, Number(row.gross), Number(row.payout), row.commission === null ? null : Number(row.commission), row.net === null ? null : Number(row.net), STATUS[row.settlementStatus] ?? row.settlementStatus]),
      };
    }

    const exportInput: ReportExportInput = {
      ...workbook,
      filename: name,
      subtitle: "ข้อมูลทั้งหมดที่ผ่านตัวกรองของรายงาน Agent",
      metadata: [
        { label: "รหัส Agent", value: report.agent.code }, { label: "ชื่อ Agent", value: report.agent.name },
        { label: "งวด", value: report.selectedDrawId || "ทุกงวด" },
        { label: "วันที่เริ่มต้น", value: report.dateFrom || "ทั้งหมด" }, { label: "วันที่สิ้นสุด", value: report.dateTo || "ทั้งหมด" },
        { label: "สถานะ Settlement", value: report.selectedSettlement },
      ],
      summary: [
        { label: "จำนวนบิล", value: report.totals.billCount, type: "integer", unit: "บิล" },
        { label: "จำนวนรายการเลข", value: report.totals.itemCount, type: "integer", unit: "รายการ" },
        { label: "ยอดขายรวม", value: Number(report.totals.gross), type: "money", unit: "บาท" },
        { label: "ค่าคอมมิชชัน", value: Number(report.totals.commission), type: "money", unit: "บาท" },
        { label: "ยอดสุทธิ", value: Number(report.totals.net), type: "money", unit: "บาท" },
        { label: "จ่ายรางวัล", value: Number(report.totals.payout), type: "money", unit: "บาท" },
      ],
    };
    const output = createReportDownload(exportInput, params.get("format") === "xlsx" ? "xlsx" : "csv");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { csvDateTime, csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { getAgentReport } from "@/lib/reports/agent-report";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { generateTableWorkbook, xlsxBody, xlsxHeaders, type TableWorkbookInput } from "@/lib/excel/table-workbook";

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

    let csv: string;
    let name: string;
    let workbook: TableWorkbookInput;
    if (report.selectedView === "prizes") {
      csv = csvFile(["รหัสรางวัล", "ประเภทรางวัล", "จำนวนรายการเลข (รายการ)", "ถูกรางวัล (รายการ)", "ยอดขาย (บาท)", "จ่ายรางวัล (บาท)"], report.prizes.map((row) => [String(row.code), row.name, String(row.count), String(row.winners), row.gross.toFixed(2), row.payout.toFixed(2)]));
      name = `รายงานประเภทรางวัล_${report.agent.code}.csv`;
      workbook = {
        title: `รายงานประเภทรางวัล ${report.agent.code} · ${report.agent.name}`,
        sheetName: "ประเภทรางวัล",
        columns: [{ header: "รหัสรางวัล", type: "text" }, { header: "ประเภทรางวัล", type: "text", width: 25 }, { header: "จำนวนรายการเลข (รายการ)", type: "integer", width: 23 }, { header: "ถูกรางวัล (รายการ)", type: "integer", width: 20 }, { header: "ยอดขาย (บาท)", type: "money" }, { header: "จ่ายรางวัล (บาท)", type: "money" }],
        rows: report.prizes.map((row) => [String(row.code), row.name, row.count, row.winners, Number(row.gross), Number(row.payout)]),
      };
    } else if (report.selectedView === "bills" || report.selectedView === "winners") {
      csv = csvFile(["เลขบิล", "ชื่อลูกค้า", "งวด", "จำนวนรายการเลข (รายการ)", "ยอดขาย (บาท)", "จ่ายรางวัล (บาท)", "วันที่สร้างบิล", "สถานะ"], report.bills.map((bill) => [visibleBillNumber(bill.drawSequence), bill.title, bill.draw.name, String(bill._count.items), bill.totalStake.toFixed(2), bill.totalPayout.toFixed(2), csvDateTime(bill.createdAt), BILL_STATUS[bill.status] ?? bill.status]));
      name = report.selectedView === "winners" ? `บิลถูกรางวัล_${report.agent.code}.csv` : `รายการบิล_${report.agent.code}.csv`;
      workbook = {
        title: `${report.selectedView === "winners" ? "บิลถูกรางวัล" : "รายการบิล"} ${report.agent.code} · ${report.agent.name}`,
        sheetName: report.selectedView === "winners" ? "บิลถูกรางวัล" : "รายการบิล",
        columns: [{ header: "เลขบิล", type: "text" }, { header: "ชื่อลูกค้า", type: "text", width: 25 }, { header: "งวด", type: "text", width: 28 }, { header: "จำนวนรายการเลข (รายการ)", type: "integer", width: 23 }, { header: "ยอดขาย (บาท)", type: "money" }, { header: "จ่ายรางวัล (บาท)", type: "money" }, { header: "วันที่สร้างบิล", type: "datetime", width: 20 }, { header: "สถานะ", type: "text", width: 16 }],
        rows: report.bills.map((bill) => [visibleBillNumber(bill.drawSequence), bill.title, bill.draw.name, bill._count.items, Number(bill.totalStake), Number(bill.totalPayout), bill.createdAt, BILL_STATUS[bill.status] ?? bill.status]),
      };
    } else if (report.selectedView === "settlements") {
      csv = csvFile(["งวด", "วันที่ปิดรับ", "ยอดขาย (บาท)", "จ่ายรางวัล (บาท)", "ค่าคอม (บาท)", "สุทธิ (บาท)", "สถานะ"], report.settlements.map((row) => [row.drawName, csvDateTime(row.cutoffAt), row.gross.toFixed(2), row.payout.toFixed(2), row.commission?.toFixed(2) ?? "", row.net?.toFixed(2) ?? "", STATUS[row.settlementStatus] ?? row.settlementStatus]));
      name = `สรุปยอด_${report.agent.code}.csv`;
      workbook = {
        title: `สรุปยอด ${report.agent.code} · ${report.agent.name}`,
        sheetName: "สรุปยอด",
        columns: [{ header: "งวด", type: "text", width: 28 }, { header: "วันที่ปิดรับ", type: "datetime", width: 20 }, { header: "ยอดขาย (บาท)", type: "money" }, { header: "จ่ายรางวัล (บาท)", type: "money" }, { header: "ค่าคอม (บาท)", type: "money" }, { header: "สุทธิ (บาท)", type: "money" }, { header: "สถานะ", type: "text", width: 18 }],
        rows: report.settlements.map((row) => [row.drawName, row.cutoffAt, Number(row.gross), Number(row.payout), row.commission === null ? null : Number(row.commission), row.net === null ? null : Number(row.net), STATUS[row.settlementStatus] ?? row.settlementStatus]),
      };
    } else {
      csv = csvFile(["งวด", "วันที่ปิดรับ", "จำนวนบิล (บิล)", "จำนวนรายการเลข (รายการ)", "ยอดขาย (บาท)", "จ่ายรางวัล (บาท)", "ค่าคอม (บาท)", "สุทธิ (บาท)", "สถานะ"], report.rows.map((row) => [row.drawName, csvDateTime(row.cutoffAt), String(row.billCount), String(row.itemCount), row.gross.toFixed(2), row.payout.toFixed(2), row.commission?.toFixed(2) ?? "", row.net?.toFixed(2) ?? "", STATUS[row.settlementStatus] ?? row.settlementStatus]));
      name = `รายงานรายงวด_${report.agent.code}.csv`;
      workbook = {
        title: `รายงานรายงวด ${report.agent.code} · ${report.agent.name}`,
        sheetName: "รายงานรายงวด",
        columns: [{ header: "งวด", type: "text", width: 28 }, { header: "วันที่ปิดรับ", type: "datetime", width: 20 }, { header: "จำนวนบิล (บิล)", type: "integer" }, { header: "จำนวนรายการเลข (รายการ)", type: "integer", width: 23 }, { header: "ยอดขาย (บาท)", type: "money" }, { header: "จ่ายรางวัล (บาท)", type: "money" }, { header: "ค่าคอม (บาท)", type: "money" }, { header: "สุทธิ (บาท)", type: "money" }, { header: "สถานะ", type: "text", width: 18 }],
        rows: report.rows.map((row) => [row.drawName, row.cutoffAt, row.billCount, row.itemCount, Number(row.gross), Number(row.payout), row.commission === null ? null : Number(row.commission), row.net === null ? null : Number(row.net), STATUS[row.settlementStatus] ?? row.settlementStatus]),
      };
    }

    if (params.get("format") === "xlsx") {
      const bytes = generateTableWorkbook({ ...workbook, subtitle: "ไฟล์ Excel จัดคอลัมน์ พร้อมตัวกรอง และเก็บยอดเงินเป็นตัวเลข" });
      return new NextResponse(xlsxBody(bytes), { headers: xlsxHeaders(name.replace(/\.csv$/i, ".xlsx")) });
    }
    return new NextResponse(csv, { headers: csvHeaders(name) });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

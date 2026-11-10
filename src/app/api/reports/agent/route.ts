import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { getAgentReport } from "@/lib/reports/agent-report";
import { visibleBillNumber } from "@/lib/bills/numbering";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { PENDING: "รอ Settlement", DRAFT: "คำนวณแล้ว", RECONCILED: "ตรวจสอบยอดแล้ว", APPROVED: "อนุมัติแล้ว" };

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
    if (report.selectedView === "prizes") {
      csv = csvFile(["รหัส", "ประเภทรางวัล", "รายการ", "ถูกรางวัล", "ยอดขาย", "จ่ายรางวัล"], report.prizes.map((row) => [String(row.code), row.name, String(row.count), String(row.winners), row.gross.toFixed(2), row.payout.toFixed(2)]));
      name = "agent-prize-report.csv";
    } else if (report.selectedView === "bills") {
      csv = csvFile(["เลขบิล", "ชื่อลูกค้า", "งวด", "รายการ", "ยอดขาย", "จ่ายรางวัล", "วันที่สร้าง", "สถานะ"], report.bills.map((bill) => [visibleBillNumber(bill.drawSequence), bill.title, bill.draw.name, String(bill._count.items), bill.totalStake.toFixed(2), bill.totalPayout.toFixed(2), bill.createdAt.toISOString(), bill.status]));
      name = "agent-bill-report.csv";
    } else if (report.selectedView === "settlements") {
      csv = csvFile(["งวด", "วันที่ปิดรับ", "ยอดขาย", "จ่ายรางวัล", "คอมมิชชัน", "สุทธิ", "สถานะ"], report.settlements.map((row) => [row.drawName, row.cutoffAt.toISOString(), row.gross.toFixed(2), row.payout.toFixed(2), row.commission?.toFixed(2) ?? "", row.net?.toFixed(2) ?? "", STATUS[row.settlementStatus] ?? row.settlementStatus]));
      name = "agent-settlement-report.csv";
    } else {
      csv = csvFile(["งวด", "วันที่ปิดรับ", "บิล", "รายการ", "ยอดขาย", "จ่ายรางวัล", "คอมมิชชัน", "สุทธิ", "สถานะ"], report.rows.map((row) => [row.drawName, row.cutoffAt.toISOString(), String(row.billCount), String(row.itemCount), row.gross.toFixed(2), row.payout.toFixed(2), row.commission?.toFixed(2) ?? "", row.net?.toFixed(2) ?? "", STATUS[row.settlementStatus] ?? row.settlementStatus]));
      name = "agent-round-report.csv";
    }

    return new NextResponse(csv, { headers: csvHeaders(name) });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

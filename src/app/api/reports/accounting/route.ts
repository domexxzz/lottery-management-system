import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { drawDateLabel } from "@/lib/bills/betting";
import { apiError } from "@/lib/http";
import { loadAccountingReport, type AccountingReport } from "@/lib/reports/accounting";
import { accountingLotterySelectionLabel, parseAccountingQuery, type AccountingQuery } from "@/lib/reports/accounting-period";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";

export const dynamic = "force-dynamic";

/** ชื่อไฟล์บอกว่าส่งออกอะไร: ช่วงวันที่ · งวดนี้/งวดที่แล้ว · งวดที่เลือก (ประเภทหวย + วันออกผล) */
function accountingFilename(query: AccountingQuery, report: AccountingReport): string {
  if (query.drawIds) {
    const draw = report.draws[0];
    if (!draw) return "account-summary_no-draw";
    const day = (draw.drawDate ?? draw.cutoffAt).toISOString().slice(0, 10);
    return `account-summary_${draw.category === "LAO_COMBINED" ? "lao-combined" : "thai-government"}_${day}`;
  }
  if (!report.range.from) return `account-summary_${query.period.replaceAll("_", "-")}`;
  return `account-summary_${report.range.from}_${report.range.to || report.range.from}`;
}

/**
 * สรุปบัญชี: CSV มีเฉพาะรายละเอียดหนึ่งแถวต่องวดต่อ Agent
 * ส่วนยอดรวมและขอบเขตรายงานอยู่ในชีต Summary ของ Excel
 * ใช้ตัวกรองเดียวกับหน้าสรุปบัญชี ไฟล์จึงตรงกับที่เห็นบนจอ
 */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const query = parseAccountingQuery(Object.fromEntries(params));
    const report = await loadAccountingReport(actor, query);
    const lotterySelection = accountingLotterySelectionLabel(query.lotteries);
    const rows: Array<Array<string | number | null>> = [];
    for (const draw of report.draws) {
      const categoryLabel = reportCategoryLabel(draw.category);
      const drawLabel = `${categoryLabel} งวด ${drawDateLabel(draw)}`;
      const status = draw.settled ? "คำนวณแล้ว" : "รอผล";
      for (const line of draw.agents) {
        rows.push([
          categoryLabel, drawLabel, status, line.code, line.name, line.bills, line.gross,
          line.commissionRate / 100, line.commission, line.estimated ? "ประมาณตาม %" : "จากผลคำนวณ",
          line.net, line.profit === null ? null : line.winners, line.profit === null ? null : line.payout,
          line.profit === null ? null : line.profit,
        ]);
      }
    }
    const totals = report.totals;
    const exportInput: ReportExportInput = {
      filename: accountingFilename(query, report),
      title: "สรุปบัญชี",
      subtitle: `หลังหักคอม = ยอดขาย - ค่าคอมมิชชัน · กำไร/ขาดทุน = ยอดขาย - จ่ายรางวัล - ค่าคอมมิชชัน (นับเฉพาะงวดที่คำนวณแล้ว)`,
      sheetName: "Details",
      metadata: [
        { label: "ช่วงข้อมูล", value: query.drawIds && report.draws[0] ? `${reportCategoryLabel(report.draws[0].category)} งวด ${drawDateLabel(report.draws[0])}` : report.range.label },
        { label: "วันที่เริ่มต้น", value: report.range.from || "ตามงวดที่เลือก" },
        { label: "วันที่สิ้นสุด", value: report.range.to || "ตามงวดที่เลือก" },
        { label: "ประเภทหวย", value: lotterySelection },
        { label: "Agent", value: query.agentId ? report.agents[0]?.name ?? query.agentId : "ทุก Agent" },
        { label: "งวดที่คำนวณแล้ว", value: totals.settledDraws, type: "integer", unit: `จาก ${totals.draws} งวด` },
      ],
      summary: [
        { label: "จำนวนงวด", value: totals.draws, type: "integer", unit: "งวด" },
        { label: "จำนวนบิล", value: totals.bills, type: "integer", unit: "บิล" },
        { label: "ยอดขายรวม (ทุกงวด)", value: totals.gross, type: "money", unit: "บาท" },
        { label: "ยอดขายที่รอผล", value: totals.pendingGross, type: "money", unit: "บาท" },
        { label: "ค่าคอมมิชชันรวม (ทุกงวด)", value: totals.commission, type: "money", unit: "บาท" },
        { label: "หลังหักคอม (ทุกงวด)", value: totals.net, type: "money", unit: "บาท" },
        { label: "ลูกค้าถูกรางวัล", value: totals.winners, type: "integer", unit: "คน" },
        // สมการกำไรใช้ฐานเดียวกัน: ยอดขายที่คำนวณแล้ว - จ่ายรางวัล - ค่าคอมที่คำนวณแล้ว = กำไร/ขาดทุน
        { label: "ยอดขายที่คำนวณแล้ว", value: totals.settledGross, type: "money", unit: "บาท" },
        { label: "จ่ายรางวัลรวม", value: totals.payout, type: "money", unit: "บาท" },
        { label: "ค่าคอมมิชชันที่คำนวณแล้ว", value: totals.settledCommission, type: "money", unit: "บาท" },
        { label: "กำไร/ขาดทุน (งวดที่คำนวณแล้ว)", value: totals.profit, type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "ประเภทหวย", type: "text", width: 18 }, { header: "งวด", type: "text", width: 30 },
        { header: "สถานะ", type: "text", width: 16 }, { header: "รหัส Agent", type: "text", width: 14 },
        { header: "ชื่อ Agent", type: "text", width: 26 }, { header: "จำนวนบิล", type: "integer", width: 14 },
        { header: "ยอดขาย", type: "money", width: 17 }, { header: "อัตราค่าคอมมิชชัน", type: "percentage", width: 19 },
        { header: "ค่าคอมมิชชัน", type: "money", width: 18 }, { header: "ที่มาค่าคอมมิชชัน", type: "text", width: 20 },
        { header: "หลังหักคอม", type: "money", width: 18 }, { header: "ลูกค้าถูกรางวัล", type: "integer", width: 19 },
        { header: "จ่ายรางวัล", type: "money", width: 18 }, { header: "กำไร/ขาดทุน", type: "money", width: 19 },
      ],
      rows,
    };
    const output = createReportDownload(exportInput, params.get("format") === "xlsx" ? "xlsx" : "csv");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    return apiError(error);
  }
}

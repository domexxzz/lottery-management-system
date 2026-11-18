import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { apiError } from "@/lib/http";
import { loadAccountingReport } from "@/lib/reports/accounting";
import { accountingLotterySelectionLabel, parseAccountingQuery } from "@/lib/reports/accounting-period";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";

export const dynamic = "force-dynamic";

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
      const drawLabel = `${lotteryLabel(draw.lotteryType)} งวด ${drawDateLabel(draw)}`;
      const status = draw.settled ? "คำนวณแล้ว" : "รอผล";
      for (const line of draw.agents) {
        rows.push([
          lotteryLabel(draw.lotteryType), drawLabel, status, line.code, line.name, line.bills, line.gross,
          line.commissionRate / 100, line.commission, line.estimated ? "ประมาณตาม %" : "จากผลคำนวณ",
          line.net, line.profit === null ? null : line.winners, line.profit === null ? null : line.payout,
          line.profit === null ? null : line.profit,
        ]);
      }
    }
    const totals = report.totals;
    const exportInput: ReportExportInput = {
      filename: `account-summary_${report.range.from || "current-draw"}_${report.range.to || report.range.from || "current-draw"}`,
      title: "สรุปบัญชี",
      subtitle: `ยอดสุทธิ = ยอดขาย - ค่าคอมมิชชัน · กำไร/ขาดทุน = ยอดสุทธิ - จ่ายรางวัล`,
      sheetName: "Details",
      metadata: [
        { label: "ช่วงข้อมูล", value: report.range.label },
        { label: "วันที่เริ่มต้น", value: report.range.from || "ตามงวดที่เลือก" },
        { label: "วันที่สิ้นสุด", value: report.range.to || "ตามงวดที่เลือก" },
        { label: "ประเภทหวย", value: lotterySelection },
        { label: "Agent", value: query.agentId ? report.agents[0]?.name ?? query.agentId : "ทุก Agent" },
        { label: "งวดที่คำนวณแล้ว", value: totals.settledDraws, type: "integer", unit: `จาก ${totals.draws} งวด` },
      ],
      summary: [
        { label: "จำนวนงวด", value: totals.draws, type: "integer", unit: "งวด" },
        { label: "จำนวนบิล", value: totals.bills, type: "integer", unit: "บิล" },
        { label: "ยอดขายรวม", value: totals.gross, type: "money", unit: "บาท" },
        { label: "ค่าคอมมิชชันรวม", value: totals.commission, type: "money", unit: "บาท" },
        { label: "ยอดสุทธิ", value: totals.net, type: "money", unit: "บาท" },
        { label: "ลูกค้าถูกรางวัล", value: totals.winners, type: "integer", unit: "คน" },
        { label: "จ่ายรางวัลรวม", value: totals.payout, type: "money", unit: "บาท" },
        { label: "กำไร/ขาดทุน", value: totals.profit, type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "ประเภทหวย", type: "text", width: 18 }, { header: "งวด", type: "text", width: 30 },
        { header: "สถานะ", type: "text", width: 16 }, { header: "รหัส Agent", type: "text", width: 14 },
        { header: "ชื่อ Agent", type: "text", width: 26 }, { header: "จำนวนบิล", type: "integer", width: 14 },
        { header: "ยอดขาย", type: "money", width: 17 }, { header: "อัตราค่าคอมมิชชัน", type: "percentage", width: 19 },
        { header: "ค่าคอมมิชชัน", type: "money", width: 18 }, { header: "ที่มาค่าคอมมิชชัน", type: "text", width: 20 },
        { header: "ยอดสุทธิ", type: "money", width: 18 }, { header: "ลูกค้าถูกรางวัล", type: "integer", width: 19 },
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

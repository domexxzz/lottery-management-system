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
    const rows: Array<Array<string | number | Date | null>> = [];
    for (const draw of report.draws) {
      const categoryLabel = reportCategoryLabel(draw.category);
      const drawLabel = draw.name || drawDateLabel(draw);
      const drawDate = draw.drawDate ?? draw.cutoffAt;
      const status = draw.settled ? "คำนวณแล้ว" : "รอผล";
      for (const line of draw.agents) {
        rows.push([
          drawDate, categoryLabel, drawLabel, status, line.code, line.name, line.bills, line.gross,
          line.commissionRate / 100, line.commission, line.net,
          line.profit === null ? null : line.winners, line.profit === null ? null : line.payout,
          line.profit === null ? null : line.profit,
          line.profit === null ? "รอผล — ยังไม่รวมกำไร/ขาดทุน" : line.estimated ? "ค่าคอมประมาณตามอัตรา Agent" : "ค่าคอมจากผล Settlement",
        ]);
      }
    }
    const totals = report.totals;
    const drawRows = report.draws.map((draw) => [
      draw.drawDate ?? draw.cutoffAt,
      reportCategoryLabel(draw.category),
      draw.name || drawDateLabel(draw),
      draw.settled ? "คำนวณแล้ว" : "รอผล",
      draw.agents.length,
      draw.bills,
      draw.gross,
      draw.commission,
      draw.net,
      draw.settled ? draw.winners : null,
      draw.settled ? draw.payout : null,
      draw.profit,
      draw.settled ? (draw.estimated ? "ค่าคอมประมาณตามอัตรา Agent" : "ค่าคอมจากผล Settlement") : "รอผล — ยังไม่รวมกำไร/ขาดทุน",
    ]);
    const agentRows = report.agents.map((agent) => [
      agent.code,
      agent.name,
      agent.draws,
      agent.pendingDraws,
      agent.bills,
      agent.gross,
      agent.commission,
      agent.net,
      agent.winners,
      agent.settledGross,
      agent.settledCommission,
      agent.payout,
      agent.profit,
      agent.pendingDraws > 0 ? `มี ${agent.pendingDraws} งวดรอผล — กำไร/ขาดทุนยังไม่รวมงวดดังกล่าว` : "คำนวณครบทุกงวด",
    ]);
    const exportInput: ReportExportInput = {
      filename: accountingFilename(query, report),
      title: "สรุปบัญชี",
      subtitle: "หนึ่งแถวต่องวดต่อ Agent · ช่องรางวัลและกำไรจะว่างจนกว่างวดจะคำนวณผลแล้ว",
      sheetName: "รายละเอียด",
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
      additionalSheets: [
        {
          sheetName: "แยกรายงวด",
          title: "สรุปบัญชีแยกรายงวด",
          subtitle: "หนึ่งแถวต่อหนึ่งงวด · ยอดรางวัลและกำไรจะแสดงเมื่องวดคำนวณผลแล้ว",
          columns: [
            { header: "วันที่ออกรางวัล", type: "date", width: 17 }, { header: "ประเภทหวย", type: "text", width: 22 },
            { header: "ชื่องวด", type: "text", width: 26 }, { header: "สถานะงวด", type: "text", width: 15 },
            { header: "จำนวน Agent", type: "integer", width: 15 }, { header: "จำนวนบิล", type: "integer", width: 13 },
            { header: "ยอดขาย (บาท)", type: "money", width: 17 }, { header: "ค่าคอม (บาท)", type: "money", width: 17 },
            { header: "ยอดส่งหลังหักคอม (บาท)", type: "money", width: 23 }, { header: "ผู้ถูกรางวัล (คน)", type: "integer", width: 19 },
            { header: "จ่ายรางวัล (บาท)", type: "money", width: 18 }, { header: "กำไร/ขาดทุน (บาท)", type: "money", width: 21 },
            { header: "หมายเหตุ", type: "text", width: 34 },
          ],
          rows: drawRows,
        },
        {
          sheetName: "แต่ละ Agent",
          title: "สรุปบัญชีแต่ละ Agent",
          subtitle: "หนึ่งแถวต่อหนึ่ง Agent · ยอดขายและค่าคอมรวมทุกงวด ส่วนกำไรนับเฉพาะงวดที่คำนวณแล้ว",
          columns: [
            { header: "รหัส Agent", type: "text", width: 14 }, { header: "ชื่อ Agent", type: "text", width: 25 },
            { header: "จำนวนงวด", type: "integer", width: 13 }, { header: "งวดรอผล", type: "integer", width: 13 },
            { header: "จำนวนบิล", type: "integer", width: 13 }, { header: "ยอดขายรวม (บาท)", type: "money", width: 19 },
            { header: "ค่าคอมรวม (บาท)", type: "money", width: 19 }, { header: "ยอดส่งหลังหักคอม (บาท)", type: "money", width: 23 },
            { header: "ผู้ถูกรางวัล (คน)", type: "integer", width: 19 }, { header: "ยอดขายที่คำนวณแล้ว (บาท)", type: "money", width: 25 },
            { header: "ค่าคอมที่คำนวณแล้ว (บาท)", type: "money", width: 25 }, { header: "จ่ายรางวัล (บาท)", type: "money", width: 18 },
            { header: "กำไร/ขาดทุน (บาท)", type: "money", width: 21 }, { header: "หมายเหตุ", type: "text", width: 40 },
          ],
          rows: agentRows,
        },
      ],
      columns: [
        { header: "วันที่ออกรางวัล", type: "date", width: 17 }, { header: "ประเภทหวย", type: "text", width: 22 },
        { header: "ชื่องวด", type: "text", width: 26 }, { header: "สถานะงวด", type: "text", width: 15 },
        { header: "รหัส Agent", type: "text", width: 14 }, { header: "ชื่อ Agent", type: "text", width: 25 },
        { header: "จำนวนบิล", type: "integer", width: 13 }, { header: "ยอดขาย (บาท)", type: "money", width: 17 },
        { header: "อัตราคอม (%)", type: "percentage", width: 16 }, { header: "ค่าคอม (บาท)", type: "money", width: 17 },
        { header: "ยอดส่งหลังหักคอม (บาท)", type: "money", width: 23 }, { header: "ผู้ถูกรางวัล (คน)", type: "integer", width: 19 },
        { header: "จ่ายรางวัล (บาท)", type: "money", width: 18 }, { header: "กำไร/ขาดทุน (บาท)", type: "money", width: 21 },
        { header: "หมายเหตุ", type: "text", width: 34 },
      ],
      rows,
    };
    const output = createReportDownload(exportInput, params.get("format") === "xlsx" ? "xlsx" : "csv");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    return apiError(error);
  }
}

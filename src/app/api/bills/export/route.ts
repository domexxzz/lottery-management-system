import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { exportBetBills } from "@/lib/bills/service";
import { parseHistoryFilter } from "@/lib/bills/history-filter";
import { resolveHistoryScope } from "@/lib/bills/history-scope";
import { BET_STATUS_LABEL, betStatusOf, drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { AppError } from "@/lib/errors";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";

export const dynamic = "force-dynamic";

/** ส่งออกประวัติรายการตามตัวกรองเดียวกับหน้าเว็บ */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const filter = parseHistoryFilter(Object.fromEntries(params));
  try {
    // ใช้ขอบเขตงวดเดียวกับหน้าเว็บ ไฟล์จึงตรงกับที่เห็นบนจอ
    const scope = await resolveHistoryScope(actor, filter);
    const bills = await exportBetBills(actor, {
      tab: filter.tab,
      lotteryType: filter.lotteryType,
      query: filter.query,
      dateFrom: filter.dateFrom,
      dateTo: filter.dateTo,
      drawId: scope.drawId || undefined,
      drawWhere: scope.drawWhere,
      agentId: filter.agentId || undefined,
      sort: filter.sort,
    });
    const period = filter.from || filter.to ? `${filter.from || "เริ่มต้น"}_ถึง_${filter.to || "ปัจจุบัน"}` : "ตามตัวกรอง";
    const totalStake = bills.reduce((sum, bill) => sum + Number(bill.totalStake), 0);
    const totalPayout = bills.reduce((sum, bill) => sum + Number(bill.totalPayout), 0);
    const exportInput: ReportExportInput = {
      filename: `bill-history_${filter.from || "all"}_${filter.to || filter.from || "all"}`,
      title: "ประวัติบิล",
      subtitle: "ข้อมูลทั้งหมดที่ผ่านตัวกรอง ไม่จำกัดเฉพาะหน้าปัจจุบัน",
      sheetName: "Details",
      metadata: [
        { label: "ช่วงข้อมูล", value: period }, { label: "ประเภทหวย", value: filter.lotteryType ? lotteryLabel(filter.lotteryType) : "ทุกประเภท" },
        { label: "สถานะ", value: filter.tab === "ALL" ? "ทุกสถานะ" : BET_STATUS_LABEL[filter.tab] },
        { label: "คำค้นหา", value: filter.query || "ทั้งหมด" },
      ],
      summary: [
        { label: "จำนวนบิล", value: bills.length, type: "integer", unit: "บิล" },
        { label: "ยอดเดิมพันรวม", value: totalStake, type: "money", unit: "บาท" },
        { label: "เงินรางวัลรวม", value: totalPayout, type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "เลขบิล", type: "text", width: 14 }, { header: "ชื่อลูกค้า", type: "text", width: 25 },
        { header: "รหัส Agent", type: "text", width: 14 }, { header: "ชื่อ Agent", type: "text", width: 25 },
        { header: "ประเภทหวย", type: "text", width: 16 }, { header: "งวด", type: "text", width: 22 },
        { header: "วันที่ทำรายการ", type: "datetime", width: 20 }, { header: "จำนวนรายการเลข", type: "integer", width: 18 },
        { header: "ยอดเดิมพัน", type: "money", width: 18 }, { header: "เงินรางวัล", type: "money", width: 18 },
        { header: "สถานะ", type: "text", width: 16 },
      ],
      rows: bills.map((bill) => [visibleBillNumber(bill.drawSequence), bill.title, bill.agent.code, bill.agent.name, lotteryLabel(bill.draw.lotteryType), drawDateLabel(bill.draw), bill.createdAt, bill._count.items, Number(bill.totalStake), Number(bill.totalPayout), BET_STATUS_LABEL[betStatusOf(bill)]]),
    };
    const output = createReportDownload(exportInput, params.get("format") === "xlsx" ? "xlsx" : "csv");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

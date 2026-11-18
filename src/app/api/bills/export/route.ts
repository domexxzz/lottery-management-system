import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { exportBetBills } from "@/lib/bills/service";
import { parseHistoryFilter } from "@/lib/bills/history-filter";
import { resolveHistoryScope } from "@/lib/bills/history-scope";
import { BET_STATUS_LABEL, betStatusOf, drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { generateTableWorkbook, xlsxBody, xlsxHeaders } from "@/lib/excel/table-workbook";

export const dynamic = "force-dynamic";

const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

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
    });
    const headers = ["เลขบิล", "ชื่อลูกค้า", "รหัส Agent", "ชื่อ Agent", "ประเภทหวย", "งวด", "วันที่ทำรายการ", "จำนวนรายการเลข (รายการ)", "ยอดเดิมพัน (บาท)", "เงินรางวัล (บาท)", "สถานะ"];
    const csv = csvFile(
      headers,
      bills.map((bill) => [
        visibleBillNumber(bill.drawSequence),
        bill.title,
        bill.agent.code,
        bill.agent.name,
        lotteryLabel(bill.draw.lotteryType),
        drawDateLabel(bill.draw),
        DATE_TIME.format(bill.createdAt),
        String(bill._count.items),
        bill.totalStake.toFixed(2),
        bill.totalPayout.toFixed(2),
        BET_STATUS_LABEL[betStatusOf(bill)],
      ]),
    );
    const period = filter.from || filter.to ? `${filter.from || "เริ่มต้น"}_ถึง_${filter.to || "ปัจจุบัน"}` : "ตามตัวกรอง";
    if (params.get("format") === "xlsx") {
      const bytes = generateTableWorkbook({
        title: "ประวัติบิล",
        subtitle: `ช่วงข้อมูล: ${period} · แสดงตามตัวกรองเดียวกับหน้าประวัติรายการ`,
        sheetName: "ประวัติบิล",
        columns: [
          { header: headers[0]!, type: "text", width: 14 },
          { header: headers[1]!, type: "text", width: 25 },
          { header: headers[2]!, type: "text", width: 14 },
          { header: headers[3]!, type: "text", width: 25 },
          { header: headers[4]!, type: "text", width: 16 },
          { header: headers[5]!, type: "text", width: 22 },
          { header: headers[6]!, type: "datetime", width: 20 },
          { header: headers[7]!, type: "integer", width: 20 },
          { header: headers[8]!, type: "money", width: 18 },
          { header: headers[9]!, type: "money", width: 18 },
          { header: headers[10]!, type: "text", width: 16 },
        ],
        rows: bills.map((bill) => [
          visibleBillNumber(bill.drawSequence), bill.title, bill.agent.code, bill.agent.name,
          lotteryLabel(bill.draw.lotteryType), drawDateLabel(bill.draw), bill.createdAt,
          bill._count.items, Number(bill.totalStake), Number(bill.totalPayout), BET_STATUS_LABEL[betStatusOf(bill)],
        ]),
      });
      return new NextResponse(xlsxBody(bytes), { headers: xlsxHeaders(`ประวัติบิล_${period}.xlsx`) });
    }
    return new NextResponse(csv, { headers: csvHeaders(`ประวัติบิล_${period}.csv`) });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

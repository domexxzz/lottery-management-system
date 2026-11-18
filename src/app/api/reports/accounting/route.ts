import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { csvFile, csvHeaders } from "@/lib/csv";
import { apiError } from "@/lib/http";
import { loadAccountingReport } from "@/lib/reports/accounting";
import { parseAccountingQuery } from "@/lib/reports/accounting-period";
import { generateTableWorkbook, xlsxBody, xlsxHeaders, type TableWorkbookCell } from "@/lib/excel/table-workbook";

export const dynamic = "force-dynamic";

const amount = (value: number) => value.toFixed(2);

/**
 * CSV สรุปบัญชี: หนึ่งแถวต่องวดต่อ Agent พร้อมแถวรวมของแต่ละงวดและแถวรวมทั้งหมด
 * ใช้ตัวกรองเดียวกับหน้าสรุปบัญชี ไฟล์จึงตรงกับที่เห็นบนจอ
 */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  try {
    const params = new URL(request.url).searchParams;
    const query = parseAccountingQuery(Object.fromEntries(params));
    const report = await loadAccountingReport(actor, query);
    const rows: string[][] = [];
    const workbookRows: TableWorkbookCell[][] = [];
    for (const draw of report.draws) {
      const drawLabel = `${lotteryLabel(draw.lotteryType)} งวด ${drawDateLabel(draw)}`;
      const status = draw.settled ? "คำนวณแล้ว" : "รอผล";
      for (const line of draw.agents) {
        rows.push([
          "รายการ Agent", drawLabel, status, line.code, line.name, String(line.bills), amount(line.gross),
          `${line.commissionRate.toFixed(2)}%`, amount(line.commission), line.estimated ? "ประมาณตาม %" : "จากผลคำนวณ",
          amount(line.net), line.profit === null ? "" : String(line.winners), line.profit === null ? "" : amount(line.payout),
          line.profit === null ? "" : amount(line.profit),
        ]);
        workbookRows.push([
          "รายการ Agent", drawLabel, status, line.code, line.name, line.bills, line.gross,
          line.commissionRate / 100, line.commission, line.estimated ? "ประมาณตาม %" : "จากผลคำนวณ",
          line.net, line.profit === null ? null : line.winners, line.profit === null ? null : line.payout,
          line.profit === null ? null : line.profit,
        ]);
      }
      rows.push([
        "รวมงวด", drawLabel, status, "", "รวมงวดนี้", String(draw.bills), amount(draw.gross), "", amount(draw.commission), "",
        amount(draw.net), draw.profit === null ? "" : String(draw.winners), draw.profit === null ? "" : amount(draw.payout),
        draw.profit === null ? "" : amount(draw.profit),
      ]);
      workbookRows.push([
        "รวมงวด", drawLabel, status, "", "รวมงวดนี้", draw.bills, draw.gross, null, draw.commission, "",
        draw.net, draw.profit === null ? null : draw.winners, draw.profit === null ? null : draw.payout,
        draw.profit === null ? null : draw.profit,
      ]);
    }
    const totals = report.totals;
    rows.push([
      "รวมทั้งหมด", `รวม ${report.range.label}`, `${totals.settledDraws}/${totals.draws} งวดคำนวณแล้ว`, "", "รวมทั้งหมด", String(totals.bills), amount(totals.gross), "",
      amount(totals.commission), "", amount(totals.net), String(totals.winners), amount(totals.payout), amount(totals.profit),
    ]);
    workbookRows.push([
      "รวมทั้งหมด", `รวม ${report.range.label}`, `${totals.settledDraws}/${totals.draws} งวดคำนวณแล้ว`, "", "รวมทั้งหมด", totals.bills,
      totals.gross, null, totals.commission, "", totals.net, totals.winners, totals.payout, totals.profit,
    ]);
    if (params.get("format") === "xlsx") {
      const bytes = generateTableWorkbook({
        title: "สรุปบัญชี",
        subtitle: `ช่วงข้อมูล: ${report.range.label} · ตัวเลขในไฟล์ตรงกับตัวกรองบนหน้ารายงาน`,
        sheetName: "สรุปบัญชี",
        columns: [
          { header: "ประเภทแถว", type: "text", width: 16 },
          { header: "งวด", type: "text", width: 30 },
          { header: "สถานะ", type: "text", width: 18 },
          { header: "รหัส Agent", type: "text", width: 14 },
          { header: "ชื่อ Agent", type: "text", width: 26 },
          { header: "จำนวนบิล (บิล)", type: "integer", width: 15 },
          { header: "ยอดขาย (บาท)", type: "money", width: 17 },
          { header: "อัตราค่าคอม", type: "percentage", width: 15 },
          { header: "ค่าคอม (บาท)", type: "money", width: 17 },
          { header: "ที่มาค่าคอม", type: "text", width: 18 },
          { header: "ยอดสุทธิ (บาท)", type: "money", width: 18 },
          { header: "ลูกค้าถูกรางวัล (คน)", type: "integer", width: 20 },
          { header: "จ่ายรางวัล (บาท)", type: "money", width: 18 },
          { header: "กำไร/ขาดทุน (บาท)", type: "money", width: 20 },
        ],
        rows: workbookRows,
      });
      return new NextResponse(xlsxBody(bytes), { headers: xlsxHeaders(`สรุปบัญชี_${report.range.label}.xlsx`) });
    }
    const csv = csvFile(
      ["ประเภทแถว", "งวด", "สถานะ", "รหัส Agent", "ชื่อ Agent", "จำนวนบิล (บิล)", "ยอดขาย (บาท)", "อัตราค่าคอม", "ค่าคอม (บาท)", "ที่มาค่าคอม", "ยอดสุทธิ (บาท) = ยอดขาย − ค่าคอม", "ลูกค้าถูกรางวัล (คน)", "จ่ายรางวัล (บาท)", "กำไร/ขาดทุน (บาท) = ยอดสุทธิ − จ่ายรางวัล"],
      rows,
    );
    return new NextResponse(csv, { headers: csvHeaders(`สรุปบัญชี_${report.range.label}.csv`) });
  } catch (error) {
    return apiError(error);
  }
}

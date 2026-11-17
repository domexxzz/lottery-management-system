import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { csvFile, csvHeaders } from "@/lib/csv";
import { apiError } from "@/lib/http";
import { loadAccountingReport } from "@/lib/reports/accounting";
import { parseAccountingQuery } from "@/lib/reports/accounting-period";

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
    const query = parseAccountingQuery(Object.fromEntries(new URL(request.url).searchParams));
    const report = await loadAccountingReport(actor, query);
    const rows: string[][] = [];
    for (const draw of report.draws) {
      const drawLabel = `${lotteryLabel(draw.lotteryType)} งวด ${drawDateLabel(draw)}`;
      const status = draw.settled ? "คำนวณแล้ว" : "รอผล";
      for (const line of draw.agents) {
        rows.push([
          drawLabel, status, `${line.code} ${line.name}`, String(line.bills), amount(line.gross),
          `${line.commissionRate.toFixed(2)}%`, amount(line.commission), line.estimated ? "ประมาณตาม %" : "จากผลคำนวณ",
          amount(line.net), line.profit === null ? "" : String(line.winners), line.profit === null ? "" : amount(line.payout),
          line.profit === null ? "" : amount(line.profit),
        ]);
      }
      rows.push([
        drawLabel, status, "รวมงวดนี้", String(draw.bills), amount(draw.gross), "", amount(draw.commission), "",
        amount(draw.net), draw.profit === null ? "" : String(draw.winners), draw.profit === null ? "" : amount(draw.payout),
        draw.profit === null ? "" : amount(draw.profit),
      ]);
    }
    const totals = report.totals;
    rows.push([
      `รวม ${report.range.label}`, `${totals.settledDraws}/${totals.draws} งวดคำนวณแล้ว`, "รวมทั้งหมด", String(totals.bills), amount(totals.gross), "",
      amount(totals.commission), "", amount(totals.net), String(totals.winners), amount(totals.payout), amount(totals.profit),
    ]);
    const csv = csvFile(
      ["งวด", "สถานะ", "Agent", "จำนวนบิล", "ยอดขาย", "อัตราค่าคอม", "ค่าคอม", "ที่มาค่าคอม", "ยอดสุทธิ (ยอดขาย − ค่าคอม)", "ลูกค้าถูกรางวัล (คน)", "จ่ายรางวัล", "กำไร/ขาดทุน (ยอดสุทธิ − จ่ายรางวัล)"],
      rows,
    );
    return new NextResponse(csv, { headers: csvHeaders("accounting-summary.csv") });
  } catch (error) {
    return apiError(error);
  }
}

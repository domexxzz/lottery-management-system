import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { byPrizeType, drawSummary } from "@/lib/reports/service";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { generateTableWorkbook, xlsxBody, xlsxHeaders } from "@/lib/excel/table-workbook";

export const dynamic = "force-dynamic";

/** รายงานแยกตามประเภทรางวัล 1 ถึง 16 เป็น CSV (LOT-33) */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;
  const drawId = id === "all" ? undefined : id;

  try {
    const [summary, rows] = await Promise.all([drawSummary(actor, drawId), byPrizeType(actor, drawId)]);

    if (new URL(request.url).searchParams.get("format") === "xlsx") {
      const bytes = generateTableWorkbook({
        title: "รายงานประเภทรางวัล",
        subtitle: `งวด: ${summary.drawName}`,
        sheetName: "ประเภทรางวัล",
        columns: [
          { header: "งวด", type: "text", width: 28 }, { header: "รหัสรางวัล", type: "text", width: 14 },
          { header: "ชื่อรางวัล", type: "text", width: 24 }, { header: "จำนวนรายการเลข (รายการ)", type: "integer", width: 23 },
          { header: "ถูกรางวัล (รายการ)", type: "integer", width: 20 }, { header: "ยอดขาย (บาท)", type: "money", width: 18 },
          { header: "จ่ายรางวัล (บาท)", type: "money", width: 18 },
        ],
        rows: rows.map((row) => [summary.drawName, String(row.code), row.name, row.itemCount, row.winnerCount, Number(row.gross), Number(row.payout)]),
      });
      return new NextResponse(xlsxBody(bytes), { headers: xlsxHeaders(`รายงานประเภทรางวัล_${summary.drawName}.xlsx`) });
    }

    const csv = csvFile(
      ["งวด", "รหัสรางวัล", "ชื่อรางวัล", "จำนวนรายการเลข (รายการ)", "ถูกรางวัล (รายการ)", "ยอดขาย (บาท)", "จ่ายรางวัล (บาท)"],
      rows.map((r) => [
        summary.drawName,
        String(r.code),
        r.name,
        String(r.itemCount),
        String(r.winnerCount),
        r.gross.toFixed(2),
        r.payout.toFixed(2),
      ]),
    );

    return new NextResponse(csv, { headers: csvHeaders(`รายงานประเภทรางวัล_${summary.drawName}.csv`) });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

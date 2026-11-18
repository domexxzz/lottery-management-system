import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { byPrizeType, drawSummary } from "@/lib/reports/service";
import { AppError } from "@/lib/errors";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";

export const dynamic = "force-dynamic";

/** รายงานแยกตามประเภทรางวัล 1 ถึง 16 เป็น CSV (LOT-33) */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;
  const drawId = id === "all" ? undefined : id;

  try {
    const [summary, rows] = await Promise.all([drawSummary(actor, drawId), byPrizeType(actor, drawId)]);

    const report: ReportExportInput = {
      filename: `prize-types_${id}`,
      title: "รายงานประเภทรางวัล",
      subtitle: `งวด: ${summary.drawName}`,
      sheetName: "Details",
      metadata: [{ label: "งวด", value: summary.drawName }],
      summary: [
        { label: "จำนวนประเภทรางวัล", value: rows.length, type: "integer", unit: "ประเภท" },
        { label: "จำนวนรายการเลข", value: rows.reduce((sum, row) => sum + row.itemCount, 0), type: "integer", unit: "รายการ" },
        { label: "รายการถูกรางวัล", value: rows.reduce((sum, row) => sum + row.winnerCount, 0), type: "integer", unit: "รายการ" },
        { label: "ยอดขายรวม", value: rows.reduce((sum, row) => sum + Number(row.gross), 0), type: "money", unit: "บาท" },
        { label: "จ่ายรางวัลรวม", value: rows.reduce((sum, row) => sum + Number(row.payout), 0), type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "งวด", type: "text", width: 28 }, { header: "รหัสรางวัล", type: "text", width: 14 },
        { header: "ชื่อรางวัล", type: "text", width: 24 }, { header: "จำนวนรายการเลข", type: "integer", width: 20 },
        { header: "ถูกรางวัล", type: "integer", width: 16 }, { header: "ยอดขาย", type: "money", width: 18 },
        { header: "จ่ายรางวัล", type: "money", width: 18 },
      ],
      rows: rows.map((row) => [summary.drawName, String(row.code), row.name, row.itemCount, row.winnerCount, Number(row.gross), Number(row.payout)]),
    };
    const output = createReportDownload(report, new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

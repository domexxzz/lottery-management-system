import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { byAgent, drawSummary } from "@/lib/reports/service";
import { AppError } from "@/lib/errors";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";

export const dynamic = "force-dynamic";

/** รายงานแยกตาม Agent เป็น CSV (LOT-33) */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;
  const drawId = id === "all" ? undefined : id;

  try {
    const [summary, rows] = await Promise.all([drawSummary(actor, drawId), byAgent(actor, drawId)]);

    const report: ReportExportInput = {
      filename: `agents-by-draw_${id}`,
      title: "รายงานตาม Agent",
      subtitle: `งวด: ${summary.drawName}`,
      sheetName: "Details",
      metadata: [{ label: "งวด", value: summary.drawName }],
      summary: [
        { label: "จำนวน Agent", value: rows.length, type: "integer", unit: "Agent" },
        { label: "จำนวนบิล", value: rows.reduce((sum, row) => sum + row.billCount, 0), type: "integer", unit: "บิล" },
        { label: "ยอดขายรวม", value: rows.reduce((sum, row) => sum + Number(row.gross), 0), type: "money", unit: "บาท" },
        { label: "จ่ายรางวัลรวม", value: rows.reduce((sum, row) => sum + Number(row.payout), 0), type: "money", unit: "บาท" },
        { label: "ค่าคอมมิชชันรวม", value: rows.reduce((sum, row) => sum + Number(row.commission), 0), type: "money", unit: "บาท" },
        { label: "ยอดสุทธิรวม", value: rows.reduce((sum, row) => sum + Number(row.net), 0), type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "งวด", type: "text", width: 28 }, { header: "รหัส Agent", type: "text", width: 14 },
        { header: "ชื่อ Agent", type: "text", width: 26 }, { header: "จำนวนบิล", type: "integer", width: 15 },
        { header: "ยอดขาย", type: "money", width: 18 }, { header: "จ่ายรางวัล", type: "money", width: 18 },
        { header: "ค่าคอมมิชชัน", type: "money", width: 18 }, { header: "ยอดสุทธิ", type: "money", width: 18 },
      ],
      rows: rows.map((row) => [summary.drawName, row.agentCode, row.agentName, row.billCount, Number(row.gross), Number(row.payout), Number(row.commission), Number(row.net)]),
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

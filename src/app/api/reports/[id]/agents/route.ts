import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { byAgent, drawSummary } from "@/lib/reports/service";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { generateTableWorkbook, xlsxBody, xlsxHeaders } from "@/lib/excel/table-workbook";

export const dynamic = "force-dynamic";

/** รายงานแยกตาม Agent เป็น CSV (LOT-33) */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;
  const drawId = id === "all" ? undefined : id;

  try {
    const [summary, rows] = await Promise.all([drawSummary(actor, drawId), byAgent(actor, drawId)]);

    if (new URL(request.url).searchParams.get("format") === "xlsx") {
      const bytes = generateTableWorkbook({
        title: "รายงานตาม Agent",
        subtitle: `งวด: ${summary.drawName}`,
        sheetName: "รายงานตาม Agent",
        columns: [
          { header: "งวด", type: "text", width: 28 }, { header: "รหัส Agent", type: "text", width: 14 },
          { header: "ชื่อ Agent", type: "text", width: 26 }, { header: "จำนวนบิล (บิล)", type: "integer", width: 17 },
          { header: "ยอดขาย (บาท)", type: "money", width: 18 }, { header: "จ่ายรางวัล (บาท)", type: "money", width: 18 },
          { header: "ค่าคอม (บาท)", type: "money", width: 18 }, { header: "สุทธิ (บาท)", type: "money", width: 18 },
        ],
        rows: rows.map((row) => [summary.drawName, row.agentCode, row.agentName, row.billCount, Number(row.gross), Number(row.payout), Number(row.commission), Number(row.net)]),
      });
      return new NextResponse(xlsxBody(bytes), { headers: xlsxHeaders(`รายงานตาม-Agent_${summary.drawName}.xlsx`) });
    }

    const csv = csvFile(
      ["งวด", "รหัส Agent", "ชื่อ Agent", "จำนวนบิล (บิล)", "ยอดขาย (บาท)", "จ่ายรางวัล (บาท)", "ค่าคอม (บาท)", "สุทธิ (บาท)"],
      rows.map((r) => [
        summary.drawName,
        r.agentCode,
        r.agentName,
        String(r.billCount),
        r.gross.toFixed(2),
        r.payout.toFixed(2),
        r.commission.toFixed(2),
        r.net.toFixed(2),
      ]),
    );

    return new NextResponse(csv, { headers: csvHeaders(`รายงานตาม-Agent_${summary.drawName}.csv`) });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

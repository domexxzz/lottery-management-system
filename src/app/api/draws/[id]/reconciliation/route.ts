import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { reconciliationExport, RECONCILIATION_COLUMNS } from "@/lib/settlement/export";
import { AppError } from "@/lib/errors";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";

export const dynamic = "force-dynamic";

/** ดาวน์โหลดไฟล์กระทบยอดของงวด (LOT-22) */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;

  try {
    const data = await reconciliationExport(actor, id);
    const types = ["text", "text", "text", "text", "text", "text", "text", "text", "text", "text", "money", "decimal", "text", "text", "money"] as const;
    const report: ReportExportInput = {
      filename: `reconciliation_${id}`,
      title: `กระทบยอด ${data.title}`,
      subtitle: "หนึ่งแถวต่อหนึ่งรายการเลข พร้อมอัตราจ่ายที่ล็อกไว้และผลที่ใช้ตัดสิน",
      sheetName: "Details",
      metadata: [{ label: "งวด", value: data.title }],
      summary: [
        { label: "จำนวนบิล", value: new Set(data.rows.map((row) => String(row[2] ?? ""))).size, type: "integer", unit: "บิล" },
        { label: "จำนวนรายการเลข", value: data.rows.length, type: "integer", unit: "รายการ" },
        { label: "ยอดเดิมพันรวม", value: data.rows.reduce((sum, row) => sum + Number(row[10] ?? 0), 0), type: "money", unit: "บาท" },
        { label: "ยอดจ่ายรวม", value: data.rows.reduce((sum, row) => sum + Number(row[14] ?? 0), 0), type: "money", unit: "บาท" },
      ],
      columns: RECONCILIATION_COLUMNS.map((header, index) => ({ header: header.replace(/ \(บาท\)$/u, ""), type: types[index], width: index === 3 || index === 5 || index === 7 ? 24 : index === 8 ? 18 : undefined })),
      rows: data.rows,
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

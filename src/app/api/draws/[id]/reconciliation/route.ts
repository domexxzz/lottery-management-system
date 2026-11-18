import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { reconciliationCsv, reconciliationExport, RECONCILIATION_COLUMNS } from "@/lib/settlement/export";
import { csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { generateTableWorkbook, xlsxBody, xlsxHeaders } from "@/lib/excel/table-workbook";

export const dynamic = "force-dynamic";

/** ดาวน์โหลดไฟล์กระทบยอดของงวด (LOT-22) */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;

  try {
    if (new URL(request.url).searchParams.get("format") === "xlsx") {
      const report = await reconciliationExport(actor, id);
      const types = ["text", "text", "text", "text", "text", "text", "text", "text", "text", "text", "money", "decimal", "text", "text", "money"] as const;
      const bytes = generateTableWorkbook({
        title: `กระทบยอด ${report.title}`,
        subtitle: "หนึ่งแถวต่อหนึ่งรายการเลข พร้อมอัตราจ่ายที่ล็อกไว้และผลที่ใช้ตัดสิน",
        sheetName: "กระทบยอด",
        columns: RECONCILIATION_COLUMNS.map((header, index) => ({ header, type: types[index], width: index === 3 || index === 5 || index === 7 ? 24 : index === 8 ? 18 : undefined })),
        rows: report.rows,
      });
      return new NextResponse(xlsxBody(bytes), { headers: xlsxHeaders(`${report.filenameBase}.xlsx`) });
    }
    const { csv, filename } = await reconciliationCsv(actor, id);
    return new NextResponse(csv, { headers: csvHeaders(filename) });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

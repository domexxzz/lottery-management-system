import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { byPrizeType, drawSummary } from "@/lib/reports/service";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** รายงานแยกตามประเภทรางวัล 1 ถึง 16 เป็น CSV (LOT-33) */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;
  const drawId = id === "all" ? undefined : id;

  try {
    const [summary, rows] = await Promise.all([drawSummary(actor, drawId), byPrizeType(actor, drawId)]);

    const csv = csvFile(
      ["รอบ", "รหัสรางวัล", "ชื่อรางวัล", "จำนวนรายการ", "ถูกรางวัล", "ยอดขาย", "จ่ายรางวัล"],
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

    return new NextResponse(csv, { headers: csvHeaders(`prize-types-${id}.csv`) });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

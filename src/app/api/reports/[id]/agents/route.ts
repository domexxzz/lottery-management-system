import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { byAgent, drawSummary } from "@/lib/reports/service";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** รายงานแยกตาม Agent เป็น CSV (LOT-33) */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;

  try {
    const [summary, rows] = await Promise.all([drawSummary(actor, id), byAgent(actor, id)]);

    const csv = csvFile(
      ["รอบ", "รหัส Agent", "ชื่อ Agent", "จำนวนบิล", "ยอดขาย", "จ่ายรางวัล", "คอมมิชชัน", "สุทธิ"],
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

    return new NextResponse(csv, { headers: csvHeaders(`agents-${id}.csv`) });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

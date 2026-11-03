import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { reconciliationCsv } from "@/lib/settlement/export";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** ดาวน์โหลดไฟล์กระทบยอดของรอบ (LOT-22) */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;

  try {
    const csv = await reconciliationCsv(actor, id);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="reconciliation-${id}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}

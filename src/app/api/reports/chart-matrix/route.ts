import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { chartMatrix } from "@/lib/reports/service";
import { parseChartMatrixQuery } from "@/lib/reports/chart-query";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  const parsed = parseChartMatrixQuery(new URL(request.url).searchParams);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const result = await chartMatrix(actor, parsed.filters);
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, max-age=15, stale-while-revalidate=30",
        "Server-Timing": `chart-matrix;dur=${result.meta.queryMs}`,
        "X-Chart-Cache": result.meta.cacheHit ? "HIT" : "MISS",
      },
    });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

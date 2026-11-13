import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { chartMatrixOptions } from "@/lib/reports/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  try {
    return NextResponse.json(await chartMatrixOptions(actor), {
      headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=120" },
    });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

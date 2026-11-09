import { NextResponse } from "next/server";
import { getActor, orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { recentCustomerNames } from "@/lib/bills/service";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * ข้อมูลประกอบหน้าสร้างบิลที่โหลดทีหลัง: ชื่อลูกค้าเดิม
 *
 * Agent ได้ข้อมูลของตนเองเสมอ ส่วน Owner/Admin ระบุผู้รับบิลด้วย ?user=
 */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const url = new URL(request.url);
  try {
    let agentId = actor.role === "AGENT" ? actor.agentId : null;
    if (actor.role !== "AGENT") {
      const userId = url.searchParams.get("user") ?? "";
      const agent = userId
        ? await prisma.agent.findFirst({ where: { ...orgScope(actor), userId }, select: { id: true } })
        : null;
      agentId = agent?.id ?? null;
    }
    if (!agentId) return NextResponse.json({ customerNames: [] }, { headers: { "Cache-Control": "no-store" } });

    const customerNames = await recentCustomerNames(actor, agentId);

    return NextResponse.json({ customerNames }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

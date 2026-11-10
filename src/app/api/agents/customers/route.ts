import { NextResponse } from "next/server";
import { getActor, orgScope, type Actor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { listOrganizationCustomers } from "@/lib/agents/customers";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { drawDay, inRange, parseDay } from "@/lib/draws/range";

export const dynamic = "force-dynamic";

const DATE_TIME = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

/** id ของงวดที่วันออกรางวัลอยู่ในช่วง — ไม่มีงวดในช่วงต้องได้ [] (ผลว่าง) ไม่ใช่ทุกงวด */
async function drawIdsInRange(actor: Actor, from: string | undefined, to: string | undefined): Promise<string[]> {
  const draws = await prisma.draw.findMany({ where: orgScope(actor), select: { id: true, drawDate: true, cutoffAt: true } });
  return draws.filter((draw) => inRange(drawDay(draw), from, to)).map((draw) => draw.id);
}

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const from = parseDay(params.get("from"));
  const to = parseDay(params.get("to"));
  const drawId = params.get("draw") || undefined;
  try {
    // ช่วงวันที่มาก่อนงวดเดียว ให้ตรงกับที่หน้าภาพรวม Agent แสดง
    const draws = from || to ? await drawIdsInRange(actor, from, to) : drawId;
    const customers = await listOrganizationCustomers(actor, draws);
    const csv = csvFile(
      ["รหัส Agent", "ชื่อ Agent", "ชื่อลูกค้า", "จำนวนบิล", "ยอดซื้อรวม", "จ่ายรางวัล", "ทำรายการล่าสุด"],
      customers.map((customer) => [
        customer.agentCode,
        customer.agentName,
        customer.name,
        String(customer.billCount),
        customer.gross.toFixed(2),
        customer.payout.toFixed(2),
        DATE_TIME.format(customer.lastBillAt),
      ]),
    );
    return new NextResponse(csv, { headers: csvHeaders("organization-agent-customers.csv") });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

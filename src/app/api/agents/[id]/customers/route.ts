import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { listAgentCustomers } from "@/lib/agents/customers";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const DATE_TIME = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;
  const drawId = new URL(request.url).searchParams.get("draw") || undefined;

  try {
    const { agent, customers } = await listAgentCustomers(actor, id, drawId);
    const csv = csvFile(
      ["รหัส Agent", "ชื่อ Agent", "ชื่อลูกค้า", "จำนวนบิล", "ยอดซื้อรวม", "จ่ายรางวัล", "ทำรายการล่าสุด"],
      customers.map((customer) => [
        agent.code,
        agent.name,
        customer.name,
        String(customer.billCount),
        customer.gross.toFixed(2),
        customer.payout.toFixed(2),
        DATE_TIME.format(customer.lastBillAt),
      ]),
    );
    const safeCode = agent.code.replace(/[^A-Za-z0-9_-]/g, "_");
    return new NextResponse(csv, { headers: csvHeaders(`agent-${safeCode}-customers.csv`) });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

import { NextResponse } from "next/server";
import { getActor } from "@/lib/auth/context";
import { listOrganizationCustomers } from "@/lib/agents/customers";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const DATE_TIME = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const drawId = new URL(request.url).searchParams.get("draw") || undefined;
  try {
    const customers = await listOrganizationCustomers(actor, drawId);
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

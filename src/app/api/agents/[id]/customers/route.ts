import { NextResponse } from "next/server";
import { getActor, orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { listAgentCustomers } from "@/lib/agents/customers";
import { AppError } from "@/lib/errors";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });

  const { id } = await context.params;
  const params = new URL(request.url).searchParams;
  const drawId = params.get("draw") || undefined;

  try {
    const { agent, customers } = await listAgentCustomers(actor, id, drawId);
    const selectedDraw = drawId
      ? await prisma.draw.findFirst({ where: { ...orgScope(actor), id: drawId }, select: { name: true } })
      : null;
    const scopeLabel = selectedDraw?.name ?? "ทุกงวด";
    const safeCode = agent.code.replace(/[^A-Za-z0-9_-]/g, "_");
    const report: ReportExportInput = {
      filename: `agent-customers_${safeCode}_${drawId || "all"}`,
      title: `รายชื่อลูกค้า ${agent.code} · ${agent.name}`,
      subtitle: `ขอบเขตข้อมูล: ${scopeLabel}`,
      sheetName: "Details",
      metadata: [
        { label: "รหัส Agent", value: agent.code }, { label: "ชื่อ Agent", value: agent.name },
        { label: "ขอบเขตข้อมูล", value: scopeLabel },
      ],
      summary: [
        { label: "จำนวนลูกค้า", value: customers.length, type: "integer", unit: "ราย" },
        { label: "จำนวนบิล", value: customers.reduce((sum, customer) => sum + customer.billCount, 0), type: "integer", unit: "บิล" },
        { label: "ยอดซื้อรวม", value: customers.reduce((sum, customer) => sum + customer.gross, 0), type: "money", unit: "บาท" },
        { label: "จ่ายรางวัลรวม", value: customers.reduce((sum, customer) => sum + customer.payout, 0), type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "ขอบเขตข้อมูล", type: "text", width: 26 }, { header: "รหัส Agent", type: "text", width: 14 },
        { header: "ชื่อ Agent", type: "text", width: 25 }, { header: "ชื่อลูกค้า", type: "text", width: 25 },
        { header: "จำนวนบิล", type: "integer", width: 15 }, { header: "ยอดซื้อรวม", type: "money", width: 18 },
        { header: "จ่ายรางวัล", type: "money", width: 18 }, { header: "ทำรายการล่าสุด", type: "datetime", width: 20 },
      ],
      rows: customers.map((customer) => [scopeLabel, agent.code, agent.name, customer.name, customer.billCount, customer.gross, customer.payout, customer.lastBillAt]),
    };
    const output = createReportDownload(report, params.get("format") === "xlsx" ? "xlsx" : "csv");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

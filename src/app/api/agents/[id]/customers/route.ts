import { NextResponse } from "next/server";
import { getActor, orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { listAgentCustomers } from "@/lib/agents/customers";
import { csvFile, csvHeaders } from "@/lib/csv";
import { AppError } from "@/lib/errors";
import { generateTableWorkbook, xlsxBody, xlsxHeaders } from "@/lib/excel/table-workbook";

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
  const params = new URL(request.url).searchParams;
  const drawId = params.get("draw") || undefined;

  try {
    const { agent, customers } = await listAgentCustomers(actor, id, drawId);
    const selectedDraw = drawId
      ? await prisma.draw.findFirst({ where: { ...orgScope(actor), id: drawId }, select: { name: true } })
      : null;
    const scopeLabel = selectedDraw?.name ?? "ทุกงวด";
    const safeCode = agent.code.replace(/[^A-Za-z0-9_-]/g, "_");
    if (params.get("format") === "xlsx") {
      const bytes = generateTableWorkbook({
        title: `รายชื่อลูกค้า ${agent.code} · ${agent.name}`,
        subtitle: `ขอบเขตข้อมูล: ${scopeLabel}`,
        sheetName: `ลูกค้า ${agent.code}`,
        columns: [
          { header: "ขอบเขตข้อมูล", type: "text", width: 26 },
          { header: "รหัส Agent", type: "text", width: 14 },
          { header: "ชื่อ Agent", type: "text", width: 25 },
          { header: "ชื่อลูกค้า", type: "text", width: 25 },
          { header: "จำนวนบิล (บิล)", type: "integer", width: 17 },
          { header: "ยอดซื้อรวม (บาท)", type: "money", width: 18 },
          { header: "จ่ายรางวัล (บาท)", type: "money", width: 18 },
          { header: "ทำรายการล่าสุด", type: "datetime", width: 20 },
        ],
        rows: customers.map((customer) => [scopeLabel, agent.code, agent.name, customer.name, customer.billCount, customer.gross, customer.payout, customer.lastBillAt]),
      });
      return new NextResponse(xlsxBody(bytes), { headers: xlsxHeaders(`ลูกค้า_${safeCode}_${scopeLabel}.xlsx`) });
    }
    const csv = csvFile(
      ["ขอบเขตข้อมูล", "รหัส Agent", "ชื่อ Agent", "ชื่อลูกค้า", "จำนวนบิล (บิล)", "ยอดซื้อรวม (บาท)", "จ่ายรางวัล (บาท)", "ทำรายการล่าสุด"],
      customers.map((customer) => [
        scopeLabel,
        agent.code,
        agent.name,
        customer.name,
        String(customer.billCount),
        customer.gross.toFixed(2),
        customer.payout.toFixed(2),
        DATE_TIME.format(customer.lastBillAt),
      ]),
    );
    return new NextResponse(csv, { headers: csvHeaders(`ลูกค้า_${safeCode}_${scopeLabel}.csv`) });
  } catch (error) {
    if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

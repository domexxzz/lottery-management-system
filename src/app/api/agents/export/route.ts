import { NextResponse } from "next/server";
import { getActor, orgScope } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/context";
import { getOrganizationMapData } from "@/lib/agents/organization-map";
import { prisma } from "@/lib/db";
import { drawDay, inRange, parseDay } from "@/lib/draws/range";
import { createReportDownload, type ReportExportInput } from "@/lib/export/report";
import { apiError } from "@/lib/http";
import { dashboardDrawLabel, drawMatchesDashboardCategory, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";

export const dynamic = "force-dynamic";

/** ส่งออกตารางภาพรวม Agent ตามช่วงเวลา คำค้น และสถานะที่ใช้อยู่บนหน้าจอ */
export async function GET(request: Request) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
  try {
    requirePermission(actor, "report.viewAllAgents");
    const params = new URL(request.url).searchParams;
    const from = parseDay(params.get("from"));
    const to = parseDay(params.get("to"));
    const drawId = params.get("draw") || undefined;
    const lottery = params.get("lottery");
    const query = (params.get("q") ?? "").trim().toLocaleLowerCase("th-TH").slice(0, 80);
    const status = params.get("status");
    const sort = params.get("sort") ?? "sales_desc";
    const draws = await prisma.draw.findMany({
      where: orgScope(actor),
      orderBy: { cutoffAt: "desc" },
      select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true, laoFamilyId: true },
    });
    const drawScope = resolveDashboardDrawScope(draws, lottery, drawId);
    const drawIds = from || to
      ? draws.filter((draw) => drawMatchesDashboardCategory(draw, drawScope.category) && inRange(drawDay(draw), from, to)).map((draw) => draw.id)
      : drawScope.drawIds;
    const mapData = await getOrganizationMapData(actor, drawIds);
    const stats = new Map(mapData.stats.map((row) => [row.agentId, row]));
    const customers = new Map<string, string[]>();
    const customerCounts = new Map<string, number>();
    for (const customer of mapData.topCustomers) {
      const names = customers.get(customer.agentId) ?? [];
      names.push(customer.name);
      customers.set(customer.agentId, names);
      customerCounts.set(customer.agentId, customer.customerCount);
    }
    const rows = mapData.agents.map((agent) => {
      const value = stats.get(agent.id) ?? { sales: 0, billCount: 0, payout: 0, commission: 0, net: 0 };
      return { ...agent, ...value, customerCount: customerCounts.get(agent.id) ?? 0, customers: customers.get(agent.id) ?? [] };
    }).filter((agent) => {
      if (status && agent.status !== status) return false;
      if (!query) return true;
      return `${agent.code} ${agent.name} ${agent.customers.join(" ")}`.toLocaleLowerCase("th-TH").includes(query);
    }).sort((a, b) => {
      if (sort === "sales_asc") return a.sales - b.sales || a.code.localeCompare(b.code, "th-TH");
      if (sort === "payout_desc") return b.payout - a.payout || a.code.localeCompare(b.code, "th-TH");
      if (sort === "name_asc") return a.code.localeCompare(b.code, "th-TH");
      return b.sales - a.sales || a.code.localeCompare(b.code, "th-TH");
    });
    const scopeLabel = from || to
      ? `${from || "เริ่มต้น"} ถึง ${to || "ปัจจุบัน"}`
      : drawScope.selectedDraw
        ? `${reportCategoryLabel(drawScope.selectedDraw.category)} · ${dashboardDrawLabel(drawScope.selectedDraw)}`
        : drawScope.category === "ALL" ? "ทุกประเภท · ทุกงวด" : `${reportCategoryLabel(drawScope.category)} · ทุกงวด`;
    const report: ReportExportInput = {
      filename: `agent-overview_${from || drawId || "all"}_${to || from || "all"}`,
      title: "ภาพรวม Agent",
      subtitle: "ข้อมูลทั้งหมดที่ผ่านตัวกรองบนหน้าภาพรวม Agent",
      sheetName: "Details",
      metadata: [
        { label: "ขอบเขตข้อมูล", value: scopeLabel }, { label: "คำค้นหา", value: query || "ทั้งหมด" },
        { label: "ประเภทหวย", value: drawScope.category === "ALL" ? "ทุกประเภท" : reportCategoryLabel(drawScope.category) },
        { label: "สถานะ Agent", value: status || "ทุกสถานะ" },
        { label: "การเรียงข้อมูล", value: sort },
      ],
      summary: [
        { label: "จำนวน Agent", value: rows.length, type: "integer", unit: "Agent" },
        { label: "จำนวนลูกค้า", value: rows.reduce((sum, row) => sum + row.customerCount, 0), type: "integer", unit: "ราย" },
        { label: "จำนวนบิล", value: rows.reduce((sum, row) => sum + row.billCount, 0), type: "integer", unit: "บิล" },
        { label: "ยอดขายรวม", value: rows.reduce((sum, row) => sum + row.sales, 0), type: "money", unit: "บาท" },
        { label: "จ่ายรางวัลรวม", value: rows.reduce((sum, row) => sum + row.payout, 0), type: "money", unit: "บาท" },
        { label: "ค่าคอมมิชชันรวม", value: rows.reduce((sum, row) => sum + row.commission, 0), type: "money", unit: "บาท" },
        { label: "ยอดสุทธิรวม", value: rows.reduce((sum, row) => sum + row.net, 0), type: "money", unit: "บาท" },
      ],
      columns: [
        { header: "รหัส Agent", type: "text", width: 14 }, { header: "ชื่อ Agent", type: "text", width: 25 },
        { header: "สถานะ", type: "text", width: 14 }, { header: "ค่าคอมหวยรัฐบาล", type: "percentage", width: 19 },
        { header: "ค่าคอมหวยลาวและหวยลาวชุด", type: "percentage", width: 25 },
        { header: "จำนวนลูกค้า", type: "integer", width: 16 }, { header: "จำนวนบิล", type: "integer", width: 14 },
        { header: "ยอดขาย", type: "money", width: 18 }, { header: "จ่ายรางวัล", type: "money", width: 18 },
        { header: "ค่าคอมมิชชัน", type: "money", width: 18 }, { header: "ยอดสุทธิ", type: "money", width: 18 },
      ],
      rows: rows.map((row) => [row.code, row.name, row.status, Number(row.commissionRate) / 100, Number(row.laoCommissionRate) / 100, row.customerCount, row.billCount, row.sales, row.payout, row.commission, row.net]),
    };
    const output = createReportDownload(report, params.get("format") === "xlsx" ? "xlsx" : "csv");
    return new NextResponse(output.body, { headers: output.headers });
  } catch (error) {
    return apiError(error);
  }
}

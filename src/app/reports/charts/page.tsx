import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { byAgent, byDraw, byPrizeType, drawSummary } from "@/lib/reports/service";
import { defaultReportDraw } from "@/lib/reports/owner-report";
import { DrawPicker } from "../DrawPicker";
import { ReportFinancialCharts } from "../ReportFinancialCharts";
import { ReportsAnalyticsDashboard } from "../ReportsAnalyticsDashboard";
import "../reports.css";

export const dynamic = "force-dynamic";

const DRAW_STATUS: Record<string, string> = {
  OPEN: "เปิดรับ",
  LOCKED: "ปิดรับแล้ว",
  RESULT_PENDING: "รอผล",
  SETTLED: "คำนวณแล้ว",
  CLOSED: "ปิดบัญชีแล้ว",
};

const reportDate = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
const reportInputDate = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Bangkok" });
const shortDate = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });

/**
 * สร้างกราฟเอง สำหรับนักบัญชีหรือคนที่อยากเจาะข้อมูล
 *
 * แยกออกจากหน้ารายงานหลัก เพื่อให้หน้าหลักเบาและอ่านง่าย
 * ค่าเริ่มต้นดูทีละงวด (งวดล่าสุดที่คำนวณแล้ว) เลือก "ทุกงวด" ได้เองเมื่อต้องการ
 */
export default async function ReportChartsPage({ searchParams }: { searchParams: Promise<{ draw?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/reports");

  const { draw: drawParam } = await searchParams;
  const draws = await prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: { cutoffAt: "desc" },
    take: 50,
    select: { id: true, name: true, status: true, lotteryType: true },
  });
  const selectedDrawId = drawParam === "all"
    ? undefined
    : draws.some((draw) => draw.id === drawParam) ? drawParam : defaultReportDraw(draws)?.id;

  const [summary, agents, prizes, drawRows, allTrendRows] = await Promise.all([
    drawSummary(actor, selectedDrawId),
    byAgent(actor, selectedDrawId),
    byPrizeType(actor, selectedDrawId),
    byDraw(actor, selectedDrawId),
    selectedDrawId ? byDraw(actor) : Promise.resolve(null),
  ]);
  const trendRows = allTrendRows ?? drawRows;

  return (
    <main className="workspace-page reports-page reports-page--blue">
      <section className="card workspace-card report-workspace report-workspace--blue" aria-labelledby="report-charts-heading">
        <Link className="report-back" href={`/reports${selectedDrawId ? `?draw=${selectedDrawId}` : ""}`}>← กลับไปหน้ารายงาน</Link>
        <header className="report-hero report-hero--blue">
          <div>
            <p className="page-eyebrow">สำหรับนักบัญชี</p>
            <h1 id="report-charts-heading">สร้างกราฟเอง</h1>
            <p>เลือกชนิดกราฟและตัวเลขที่อยากเปรียบเทียบเอง ค่าเริ่มต้นแสดงงวดล่าสุดที่คำนวณแล้ว</p>
          </div>
          <div className="report-hero-actions">
            <DrawPicker allInUrl selectedId={selectedDrawId ?? "all"} draws={draws.map((draw) => ({ id: draw.id, label: `${draw.name} — ${DRAW_STATUS[draw.status] ?? draw.status}`, lotteryType: draw.lotteryType }))} />
          </div>
        </header>

        <ReportsAnalyticsDashboard
          selectedDrawId={selectedDrawId}
          summary={{ gross: summary.gross.toNumber(), billCount: summary.billCount, itemCount: summary.itemCount }}
          draws={trendRows.map((draw) => ({ id: draw.drawId, code: reportDate.format(draw.cutoffAt), date: reportInputDate.format(draw.cutoffAt), name: draw.drawName, href: `/draws/${draw.drawId}`, gross: draw.gross.toNumber(), payout: draw.payout.toNumber(), commission: draw.commission.toNumber(), net: draw.net.toNumber(), bills: draw.billCount, items: draw.itemCount, winners: draw.winnerCount }))}
          agents={agents.map((agent) => ({ id: agent.agentId, code: agent.agentCode, name: agent.agentName, href: `/agents/${agent.agentId}`, gross: agent.gross.toNumber(), payout: agent.payout.toNumber(), commission: agent.commission.toNumber(), net: agent.net.toNumber(), bills: agent.billCount, items: agent.itemCount, winners: agent.winnerCount }))}
          prizes={prizes.map((prize) => ({ id: String(prize.code), code: String(prize.code), name: prize.name, gross: prize.gross.toNumber(), payout: prize.payout.toNumber(), commission: 0, net: prize.gross.minus(prize.payout).toNumber(), bills: 0, items: prize.itemCount, winners: prize.winnerCount }))}
        />

        <ReportFinancialCharts id="financial-trends" rows={drawRows.map((draw) => ({
          id: draw.drawId,
          label: shortDate.format(draw.cutoffAt),
          name: draw.drawName,
          gross: draw.gross.toNumber(),
          payout: draw.payout.toNumber(),
          net: draw.net.toNumber(),
        }))} />
      </section>
    </main>
  );
}

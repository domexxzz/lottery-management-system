import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { orgScope } from "@/lib/auth/context";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { prisma } from "@/lib/db";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";
import { loadOwnerReport } from "@/lib/reports/owner-report";
import { DashboardFilters } from "../DashboardFilters";
import { DashboardIcon } from "../DashboardIcon";
import { AgentReports } from "./AgentReports";
import { OwnerReport } from "./OwnerReport";

export const dynamic = "force-dynamic";

/**
 * หน้ารายงาน
 *
 * - Agent: รายงานของตนเอง (AgentReports)
 * - Owner/Admin: ตอบ 3 คำถาม ได้หรือเสีย / ต้องทำอะไร / เงินมาจากไหน ทีละงวด
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ draw?: string; drawId?: string; lottery?: string; dateFrom?: string; dateTo?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (actor.role === "AGENT") return <AgentReports actor={actor} />;

  const { draw, drawId, lottery, dateFrom, dateTo } = await searchParams;
  const physicalDraws = await prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: { cutoffAt: "desc" },
    select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true, laoFamilyId: true },
  });
  const drawScope = resolveDashboardDrawScope(physicalDraws, lottery, drawId ?? draw);
  const reportLottery = drawScope.category === "THAI_GOVERNMENT" ? "THAI_GOVERNMENT" : drawScope.category === "LAO_COMBINED" ? "LAO" : undefined;
  const dashboardFilters = <DashboardFilters
    draws={drawScope.logicalDraws.map((row) => ({ id: row.id, label: `${reportCategoryLabel(row.category)} · ${dashboardDrawLabel(row)}`, lotteryType: row.lotteryType, category: row.category, status: row.status }))}
    category={drawScope.category}
    selectedDrawId={drawScope.selectedDraw?.id}
  />;
  const report = await loadOwnerReport(actor, drawScope.selectedDraw?.id ?? "all", reportLottery, dateFrom, dateTo);
  if (!report) {
    return (
      <main className="workspace-page">
        <section className="card workspace-card">
          <h1>รายงาน</h1>
          {dashboardFilters}
          <p>{physicalDraws.length === 0 ? "ยังไม่มีงวดในระบบ สร้างงวดและรับบิลก่อน แล้วรายงานจะขึ้นที่นี่" : "ไม่พบข้อมูลงวดที่ตรงกับตัวกรองปัจจุบัน"}</p>
          {physicalDraws.length === 0 && <Link href="/draws">ไปหน้างวด →</Link>}
        </section>
      </main>
    );
  }
  const commissionParams = new URLSearchParams();
  if (drawScope.category !== "ALL") commissionParams.set("lottery", drawScope.category);
  if (drawScope.selectedDraw) commissionParams.set("drawId", drawScope.selectedDraw.id);
  return <OwnerReport report={report} filters={<>
    {dashboardFilters}
    <nav className="report-shortcuts" aria-label="รายงานที่เกี่ยวข้อง">
      <Link className="is-commission" href={`/reports/commissions${commissionParams.size ? `?${commissionParams}` : ""}`}><DashboardIcon name="wallet" />จ่ายค่าคอม Agent</Link>
      <Link className="is-accounting" href="/reports/accounting"><DashboardIcon name="analytics" />สรุปบัญชี</Link>
    </nav>
  </>} />;
}

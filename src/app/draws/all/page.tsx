import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listDraws } from "@/lib/draws/service";
import { DrawTable, getDrawDisplayStatus } from "../DrawTable";
import { ReportExportButtons } from "@/components/ReportExportButtons";
import { DashboardFilters } from "../../DashboardFilters";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { drawDay, inRange, parseDay } from "@/lib/draws/range";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";
import "../draws.css";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AllDrawsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const params = await searchParams;
  const requestedStatus = first(params.status) ?? "";
  const allowedStatuses = new Set(["OPEN", "CLOSED", "CHECKED"]);
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "";
  const allDraws = await listDraws(actor, null, "opensAt");
  const drawScope = resolveDashboardDrawScope(allDraws, first(params.lottery), first(params.drawId));
  const dateFrom = parseDay(first(params.dateFrom));
  const dateTo = parseDay(first(params.dateTo));
  const draws = allDraws.filter((draw) => (
    (drawScope.drawIds === undefined || drawScope.drawIds.includes(draw.id))
    && inRange(drawDay(draw), dateFrom, dateTo)
    && (!status || getDrawDisplayStatus(draw) === status)
  ));
  const canManage = can(actor.role, "draw.manage");
  const canDelete = can(actor.role, "draw.delete");
  const canEnterResults = can(actor.role, "result.enter");
  const canReviewResults = can(actor.role, "result.approve") && !canEnterResults;
  const exportParams = new URLSearchParams({ format: "xlsx" });
  if (status) exportParams.set("status", status);
  if (drawScope.category !== "ALL") exportParams.set("lottery", drawScope.category);
  if (drawScope.selectedDraw) exportParams.set("drawId", drawScope.selectedDraw.id);
  if (dateFrom) exportParams.set("dateFrom", dateFrom);
  if (dateTo) exportParams.set("dateTo", dateTo);

  return <main className="workspace-page">
    <section className="card workspace-card" aria-labelledby="all-draws-heading">
      <p><Link href="/draws">← กลับหน้าจัดการงวด</Link></p>
      <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">All Draws</p><h1 id="all-draws-heading">งวดทั้งหมด</h1><p>ดูประวัติและดำเนินการกับทุกงวด เรียงตามวันที่เปิดรับจากใหม่ไปเก่า</p></div><div className="draw-hero-actions"><span className="draw-total-badge">{draws.length} / {allDraws.length} งวด</span><ReportExportButtons excelHref={`/api/draws/export?${exportParams}`} /></div></header>
      <DashboardFilters
        draws={drawScope.logicalDraws.map((draw) => ({
          id: draw.id,
          label: `${reportCategoryLabel(draw.category)} · ${dashboardDrawLabel(draw)}`,
          lotteryType: draw.lotteryType,
          category: draw.category,
          status: draw.status,
        }))}
        category={drawScope.category}
        selectedDrawId={drawScope.selectedDraw?.id}
      />
      <DrawTable draws={draws} canEnterResults={canEnterResults} canReviewResults={canReviewResults} canManage={canManage} canDelete={canDelete} />
    </section>
  </main>;
}

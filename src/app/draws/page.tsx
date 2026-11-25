import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listDraws } from "@/lib/draws/service";
import { currentMonthOfficialDrawDates, officialDrawName, upcomingOfficialDrawDates } from "@/lib/draws/schedule";
import { CreateDrawWizard } from "./DrawForms";
import { prisma } from "@/lib/db";
import { orgScope } from "@/lib/auth/context";
import { DRAW_STATUS_LABEL, DrawTable, getDrawDisplayStatus } from "./DrawTable";
import { ReportExportButtons } from "@/components/ReportExportButtons";
import { DashboardFilters } from "../DashboardFilters";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { drawDay, inRange, parseDay } from "@/lib/draws/range";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";
import "./draws.css";

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function DrawsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const params = await searchParams;
  const allDraws = await listDraws(actor, null);
  const drawScope = resolveDashboardDrawScope(allDraws, first(params.lottery), first(params.drawId));
  const dateFrom = parseDay(first(params.dateFrom));
  const dateTo = parseDay(first(params.dateTo));
  const draws = allDraws.filter((draw) => (
    (drawScope.drawIds === undefined || drawScope.drawIds.includes(draw.id))
    && inRange(drawDay(draw), dateFrom, dateTo)
  ));
  const latestDraws = draws.slice(0, 5);
  const canManage = can(actor.role, "draw.manage");
  const canDelete = can(actor.role, "draw.delete");
  const canEnterResults = can(actor.role, "result.enter");
  const canReviewResults = can(actor.role, "result.approve") && !canEnterResults;
  const existingDrawNames = new Set(allDraws.map((draw) => draw.name));
  const now = new Date();
  const upcomingDrawDates = upcomingOfficialDrawDates(now);
  const selectableDrawDates = Array.from(new Set([
    ...currentMonthOfficialDrawDates(now),
    ...upcomingDrawDates,
  ]))
    .sort((left, right) => left.localeCompare(right));
  const createdDrawDates = selectableDrawDates
    .filter((date) => existingDrawNames.has(officialDrawName(date) ?? ""));
  const automaticDrawDate = upcomingDrawDates[0] ?? selectableDrawDates[0] ?? "";
  // งวดหวยลาวที่สร้างไว้แล้วในช่วงใกล้ ๆ ใช้เตือนไม่ให้สร้างซ้ำวันเดียวกัน
  const laoCreated = canManage ? await prisma.draw.findMany({
    where: { ...orgScope(actor), lotteryType: { in: ["LAO", "LAO_SET"] }, drawDate: { gte: new Date(now.getTime() - 86_400_000) } },
    select: { drawDate: true, lotteryType: true },
  }) : [];
  const exportParams = new URLSearchParams({ format: "xlsx" });
  if (drawScope.category !== "ALL") exportParams.set("lottery", drawScope.category);
  if (drawScope.selectedDraw) exportParams.set("drawId", drawScope.selectedDraw.id);
  if (dateFrom) exportParams.set("dateFrom", dateFrom);
  if (dateTo) exportParams.set("dateTo", dateTo);
  const allDrawsHrefParams = new URLSearchParams(exportParams);
  allDrawsHrefParams.delete("format");

  return (
    <main className="workspace-page">
      <section className="card workspace-card" aria-labelledby="draws-heading">
        <p><Link href="/">← หน้าภาพรวม</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Draw Operations</p><h1 id="draws-heading">จัดการงวด</h1><p>สร้างงวดใหม่ก่อนเริ่มงาน และติดตามวงจรตั้งแต่เปิดรับจนถึงปิดบัญชี</p></div><ReportExportButtons excelHref={`/api/draws/export?${exportParams}`} /></header>

        {canManage && <section className="create-draw-panel create-draw-panel-primary" aria-labelledby="create-draw-heading">
          <div className="draw-section-heading">
            <div><p className="page-eyebrow">Create New Draw</p><h2 id="create-draw-heading">สร้างงวดใหม่</h2><p>กดสร้างงวด เลือกประเภทหวย แล้วตั้งวันและเวลา ระบบใส่ค่ามาตรฐานให้ แก้ได้ก่อนยืนยัน</p></div>
          </div>
          <CreateDrawWizard
            thai={{ drawDates: selectableDrawDates, automaticDrawDate, createdDrawDates }}
            laoCreated={laoCreated.flatMap((row) => row.drawDate ? [{ date: row.drawDate.toISOString().slice(0, 10), lotteryType: row.lotteryType }] : [])}
          />
          <p className="draw-form-note">เมื่อถึงเวลาปิดรับ งานอัตโนมัติจะล็อกบิลที่ยืนยันแล้วและยกเลิกบิลร่างที่ค้างอยู่</p>
        </section>}

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

        <section className="draw-overview-section" aria-labelledby="draw-overview-heading">
          <div className="draw-section-heading"><div><p className="page-eyebrow">Draw Summary</p><h2 id="draw-overview-heading">สถานะของงวดทั้งหมด</h2></div><span>{draws.length} งวด</span></div>
          <div className="draw-status-overview">{Object.entries(DRAW_STATUS_LABEL).map(([status, label]) => {
            const count = draws.filter((draw) => getDrawDisplayStatus(draw) === status).length;
            const statusParams = new URLSearchParams(allDrawsHrefParams);
            statusParams.set("status", status);
            return <Link
              key={status}
              href={`/draws/all?${statusParams}`}
              prefetch={false}
              className={`draw-status-${status.toLowerCase()}`}
              aria-label={`${label} ${count} งวด ดูรายการทั้งหมด`}
            >
              <span>{label}</span><strong>{count}</strong><small>งวด</small><b>ดูงวด →</b>
            </Link>;
          })}</div>
        </section>

        <section className="draw-latest-section" aria-labelledby="latest-draws-heading">
          <div className="draw-section-heading">
            <div><p className="page-eyebrow">Recent Draws</p><h2 id="latest-draws-heading">5 งวดล่าสุด</h2><p>เรียงตามลำดับที่กดสร้าง จากใหม่ไปเก่า</p></div>
            <Link className="draw-view-all" href={`/draws/all${allDrawsHrefParams.size ? `?${allDrawsHrefParams}` : ""}`}>ดูงวดทั้งหมด ({draws.length}) →</Link>
          </div>
          <DrawTable draws={latestDraws} canEnterResults={canEnterResults} canReviewResults={canReviewResults} canManage={canManage} canDelete={canDelete} />
          {draws.length > 5 && <p className="draw-list-note">หน้านี้แสดงเฉพาะ 5 งวดล่าสุดตามตัวกรอง เพื่อให้ค้นหางานปัจจุบันได้ง่ายขึ้น</p>}
        </section>
      </section>
    </main>
  );
}

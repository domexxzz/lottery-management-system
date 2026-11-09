import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listDraws } from "@/lib/draws/service";
import { currentMonthOfficialDrawDates, officialDrawName, upcomingOfficialDrawDates } from "@/lib/draws/schedule";
import { CreateDrawForm } from "./DrawForms";
import { DRAW_STATUS_LABEL, DrawTable, getDrawDisplayStatus } from "./DrawTable";
import "./draws.css";

export const dynamic = "force-dynamic";

export default async function DrawsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const draws = await listDraws(actor, null);
  const latestDraws = draws.slice(0, 5);
  const canManage = can(actor.role, "draw.manage");
  const canEnterResults = can(actor.role, "result.enter");
  const canReviewResults = can(actor.role, "result.approve") && !canEnterResults;
  const existingDrawNames = new Set(draws.map((draw) => draw.name));
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

  return (
    <main className="workspace-page">
      <section className="card workspace-card" aria-labelledby="draws-heading">
        <p><Link href="/">← หน้าภาพรวม</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Draw Operations</p><h1 id="draws-heading">จัดการงวด</h1><p>สร้างงวดใหม่ก่อนเริ่มงาน และติดตามวงจรตั้งแต่เปิดรับจนถึงปิดบัญชี</p></div></header>

        {canManage && <section className="create-draw-panel create-draw-panel-primary" aria-labelledby="create-draw-heading">
          <div className="draw-section-heading">
            <div><p className="page-eyebrow">Create New Draw</p><h2 id="create-draw-heading">สร้างงวดใหม่</h2><p>เลือกเฉพาะงวดวันที่ 1 หรือ 16 ระบบกำหนดเวลาเปิด–ปิดรับให้อัตโนมัติ</p></div>
          </div>
          <CreateDrawForm drawDates={selectableDrawDates} automaticDrawDate={automaticDrawDate} createdDrawDates={createdDrawDates} />
          <p className="draw-form-note">เมื่อถึงเวลาปิดรับ งานอัตโนมัติจะล็อกบิลที่ยืนยันแล้วและยกเลิกบิลร่างที่ค้างอยู่</p>
        </section>}

        <section className="draw-overview-section" aria-labelledby="draw-overview-heading">
          <div className="draw-section-heading"><div><p className="page-eyebrow">Draw Summary</p><h2 id="draw-overview-heading">สถานะของงวดทั้งหมด</h2></div><span>{draws.length} งวด</span></div>
          <div className="draw-status-overview">{Object.entries(DRAW_STATUS_LABEL).map(([status, label]) => {
            const count = draws.filter((draw) => getDrawDisplayStatus(draw) === status).length;
            return <Link
              key={status}
              href={{ pathname: "/draws/all", query: { status } }}
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
            <Link className="draw-view-all" href="/draws/all">ดูงวดทั้งหมด ({draws.length}) →</Link>
          </div>
          <DrawTable draws={latestDraws} canEnterResults={canEnterResults} canReviewResults={canReviewResults} canManage={canManage} />
          {draws.length > 5 && <p className="draw-list-note">หน้านี้แสดงเฉพาะ 5 งวดล่าสุด เพื่อให้ค้นหางานปัจจุบันได้ง่ายขึ้น</p>}
        </section>
      </section>
    </main>
  );
}

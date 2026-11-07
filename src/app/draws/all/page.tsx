import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listDraws } from "@/lib/draws/service";
import { DrawTable, getDrawDisplayStatus } from "../DrawTable";
import { AllDrawFilters } from "./AllDrawFilters";
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
  const query = first(params.q)?.trim().toLocaleLowerCase("th-TH") ?? "";
  const requestedStatus = first(params.status) ?? "";
  const allowedStatuses = new Set(["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED", "CLOSED"]);
  const status = allowedStatuses.has(requestedStatus) ? requestedStatus : "";
  const allDraws = await listDraws(actor, null, "opensAt");
  const draws = allDraws.filter((draw) => (
    (!query || draw.name.toLocaleLowerCase("th-TH").includes(query))
    && (!status || getDrawDisplayStatus(draw) === status)
  ));
  const canManage = can(actor.role, "draw.manage");
  const canEnterResults = can(actor.role, "result.enter");
  const canReviewResults = can(actor.role, "result.approve") && !canEnterResults;

  return <main className="workspace-page">
    <section className="card workspace-card" aria-labelledby="all-draws-heading">
      <p><Link href="/draws">← กลับหน้าจัดการงวด</Link></p>
      <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">All Draws</p><h1 id="all-draws-heading">งวดทั้งหมด</h1><p>ดูประวัติและดำเนินการกับทุกงวด เรียงตามวันที่เปิดรับจากใหม่ไปเก่า</p></div><span className="draw-total-badge">{draws.length} / {allDraws.length} งวด</span></header>
      <AllDrawFilters draws={allDraws.map((draw) => ({ id: draw.id, name: draw.name, status: getDrawDisplayStatus(draw) }))} />
      <DrawTable draws={draws} canEnterResults={canEnterResults} canReviewResults={canReviewResults} canManage={canManage} />
    </section>
  </main>;
}

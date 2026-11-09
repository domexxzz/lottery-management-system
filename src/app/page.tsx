import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getActor } from "@/lib/auth/context";
import { ManagementDashboard } from "./ManagementDashboard";
import { AgentDashboard } from "./AgentDashboard";
import { AdminDashboard } from "./AdminDashboard";

function DashboardLoading() {
  return (
    <section className="route-state" role="status">
      <div className="card">
        <strong>กำลังโหลดภาพรวม…</strong>
        <div className="route-skeleton" aria-hidden="true"><span /><span /><span /></div>
      </div>
    </section>
  );
}

/*
 * ทุกหน้าในแอปนี้ผูกกับ session ของผู้ใช้ จึงต้องไม่ถูกทำเป็น static
 *
 * นอกจากเรื่องความถูกต้องแล้ว ยังตัดงาน static generation ตอน build ออกด้วย
 * ซึ่งเป็นขั้นที่กินหน่วยความจำจนถูก OOM killer ฆ่าบนเครื่อง build ขนาดเล็ก
 */
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  const query = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

  const filters = {
    drawId: first(query.drawId),
    agentId: undefined,
    status: first(query.status),
    dateFrom: first(query.dateFrom),
    dateTo: first(query.dateTo),
  };

  return (
    <Suspense fallback={<DashboardLoading />}>
      {actor.role === "ADMIN" && <AdminDashboard actor={actor} filters={filters} />}
      {(actor.role === "GODMODE" || actor.role === "OWNER") && <ManagementDashboard actor={actor} filters={filters} />}
      {actor.role === "AGENT" && <AgentDashboard actor={actor} drawId={first(query.drawId)} />}
    </Suspense>
  );
}

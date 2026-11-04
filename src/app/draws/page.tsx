import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listDraws } from "@/lib/draws/service";
import { CreateDrawForm, LockDrawForm } from "./DrawForms";
import "./draws.css";

export const dynamic = "force-dynamic";

const BANGKOK = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

const STATUS_LABEL: Record<string, string> = {
  OPEN: "เปิดรับ",
  LOCKED: "ปิดรับแล้ว",
  RESULT_PENDING: "รอผล",
  SETTLED: "คำนวณแล้ว",
  CLOSED: "ปิดบัญชี",
};

export default async function DrawsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const draws = await listDraws(actor);
  const canManage = can(actor.role, "draw.manage");

  return (
    <main className="workspace-page">
      <section className="card workspace-card" aria-labelledby="draws-heading">
        <p><Link href="/">← หน้าภาพรวม</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Draw Operations</p><h1 id="draws-heading">จัดการรอบ</h1><p>ติดตามวงจรตั้งแต่เปิดรับ ปิดรับ ลงผล กระทบยอด จนถึงปิดบัญชี</p></div></header>
        <div className="draw-status-overview">{Object.entries(STATUS_LABEL).map(([status, label]) => <div key={status} className={`draw-status-${status.toLowerCase()}`}><span>{label}</span><strong>{draws.filter((draw) => draw.status === status).length}</strong><small>รอบ</small></div>)}</div>

        <div className="table-wrap"><table>
          <thead>
            <tr>
              <th scope="col">ชื่อรอบ</th>
              <th scope="col">เปิดรับ</th>
              <th scope="col">ปิดรับ</th>
              <th scope="col">บิล</th>
              <th scope="col">สถานะ</th>
              {canManage && <th scope="col">การจัดการ</th>}
            </tr>
          </thead>
          <tbody>
            {draws.map((draw) => (
              <tr key={draw.id}>
                <td>
                  <Link href={`/draws/${draw.id}`}>{draw.name}</Link>
                </td>
                <td>{BANGKOK.format(draw.opensAt)}</td>
                <td>{BANGKOK.format(draw.cutoffAt)}</td>
                <td>{draw._count.bills}</td>
                <td>
                  <span className={`status-pill ${draw.status === "OPEN" || draw.status === "CLOSED" ? "success" : draw.status === "RESULT_PENDING" ? "warning" : "info"}`}>{STATUS_LABEL[draw.status] ?? draw.status}</span>
                  {draw.lockedAt !== null && (
                    <span className="muted"> · {BANGKOK.format(draw.lockedAt)}</span>
                  )}
                </td>
                {canManage && (
                  <td>{draw.status === "OPEN" && <LockDrawForm drawId={draw.id} />}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table></div>

        {canManage && (
          <details className="create-draw-panel">
            <summary><span><strong>สร้างรอบใหม่</strong><small>กำหนดวันเปิดรับและเวลาปิดรับ</small></span><b>＋ เปิดฟอร์ม</b></summary>
            <p className="muted">
              เมื่อถึงเวลาปิดรับ งานอัตโนมัติจะล็อกบิลที่ยืนยันแล้วและยกเลิกบิลร่างที่ค้างอยู่
            </p>
            <CreateDrawForm />
          </details>
        )}
      </section>
    </main>
  );
}

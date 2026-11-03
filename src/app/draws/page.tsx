import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listDraws } from "@/lib/draws/service";
import { CreateDrawForm, LockDrawForm } from "./DrawForms";

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
    <main>
      <section className="card" aria-labelledby="draws-heading">
        <p>
          <Link href="/">← หน้าแรก</Link>
        </p>
        <h1 id="draws-heading">รอบ</h1>

        <table>
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
                <td>{draw.name}</td>
                <td>{BANGKOK.format(draw.opensAt)}</td>
                <td>{BANGKOK.format(draw.cutoffAt)}</td>
                <td>{draw._count.bills}</td>
                <td>
                  {STATUS_LABEL[draw.status] ?? draw.status}
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
        </table>

        {canManage && (
          <>
            <h2>สร้างรอบใหม่</h2>
            <p className="muted">
              เมื่อถึงเวลาปิดรับ งานอัตโนมัติจะล็อกบิลที่ยืนยันแล้วและยกเลิกบิลร่างที่ค้างอยู่
            </p>
            <CreateDrawForm />
          </>
        )}
      </section>
    </main>
  );
}

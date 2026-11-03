import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { permissionsFor } from "@/lib/auth/permissions";
import { logoutAction } from "./logout-action";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "เจ้าของกิจการ",
  ADMIN: "ผู้ดูแลระบบ",
  CHECKER: "ผู้ตรวจสอบ",
  AGENT: "ตัวแทน",
};

export default async function HomePage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const permissions = permissionsFor(actor.role);

  return (
    <main>
      <section className="card" aria-labelledby="home-heading">
        <h1 id="home-heading">ระบบบริหารจัดการลอตเตอรี่</h1>
        <p className="muted">
          {actor.displayName} · {ROLE_LABEL[actor.role] ?? actor.role}
          {actor.agentId !== null && " · ผูกกับ Agent แล้ว"}
        </p>

        <nav aria-label="เมนูหลัก">
          <p>
            <Link href="/bills">
              <button type="button">รายการบิล</button>
            </Link>{" "}
            <Link href="/draws">
              <button type="button">รอบ</button>
            </Link>{" "}
            <Link href="/prize-types">
              <button type="button">Rulebook รางวัล</button>
            </Link>{" "}
            {permissions.includes("agent.manage") && (
              <Link href="/agents">
                <button type="button">จัดการ Agent</button>
              </Link>
            )}
          </p>
        </nav>

        <h2>สิทธิ์ของบทบาทนี้</h2>
        <table>
          <caption className="muted">
            ตรวจจากฝั่ง server ทุกคำขอ ไม่ได้อาศัยการซ่อนปุ่มบนหน้าจอ
          </caption>
          <thead>
            <tr>
              <th scope="col">สิทธิ์</th>
            </tr>
          </thead>
          <tbody>
            {permissions.map((p) => (
              <tr key={p}>
                <td>
                  <code>{p}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <form action={logoutAction}>
          <button type="submit">ออกจากระบบ</button>
        </form>
      </section>
    </main>
  );
}

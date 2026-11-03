import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listBills } from "@/lib/bills/service";
import { statusLabel } from "@/lib/bills/lifecycle";

export const dynamic = "force-dynamic";

export default async function BillsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const bills = await listBills(actor, {});

  return (
    <main>
      <section className="card" aria-labelledby="bills-heading">
        <p>
          <Link href="/">← หน้าแรก</Link>
        </p>
        <h1 id="bills-heading">รายการบิล</h1>
        <p className="muted">
          {actor.role === "AGENT"
            ? "แสดงเฉพาะบิลของคุณ"
            : "แสดงบิลทั้งหมดในองค์กร"}
        </p>

        {can(actor.role, "bill.create") && (
          <p>
            <Link href="/bills/new">
              <button type="button">สร้างบิลใหม่</button>
            </Link>
          </p>
        )}

        {bills.length === 0 ? (
          <p className="muted">ยังไม่มีบิล</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">เลขบิล</th>
                <th scope="col">ชื่อบิล</th>
                <th scope="col">รอบ</th>
                <th scope="col">Agent</th>
                <th scope="col">รายการ</th>
                <th scope="col">ยอดรวม</th>
                <th scope="col">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {bills.map((bill) => (
                <tr key={bill.id}>
                  <td>
                    <Link href={`/bills/${bill.id}`}>{bill.billNumber ?? "(ร่าง)"}</Link>
                  </td>
                  <td>{bill.title}</td>
                  <td>{bill.draw.name}</td>
                  <td>
                    {bill.agent.code} {bill.agent.name}
                  </td>
                  <td>{bill._count.items}</td>
                  <td>{bill.totalStake.toFixed(2)}</td>
                  <td>{statusLabel(bill.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

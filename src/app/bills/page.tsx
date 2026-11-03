import Link from "next/link";
import { redirect } from "next/navigation";
import type { BillStatus } from "@prisma/client";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { searchBills } from "@/lib/reports/service";
import { statusLabel } from "@/lib/bills/lifecycle";
import "./bills.css";

export const dynamic = "force-dynamic";

const STATUSES: BillStatus[] = ["DRAFT", "CONFIRMED", "LOCKED", "SETTLED", "CANCELLED"];

function readStatus(raw: string | undefined): BillStatus | undefined {
  return STATUSES.includes(raw as BillStatus) ? (raw as BillStatus) : undefined;
}

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; draw?: string; agent?: string; status?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const params = await searchParams;
  const canSeeAllAgents = can(actor.role, "report.viewAllAgents");

  const [bills, draws, agents] = await Promise.all([
    searchBills(actor, {
      query: params.q,
      drawId: params.draw === "" ? undefined : params.draw,
      agentId: params.agent === "" ? undefined : params.agent,
      status: readStatus(params.status),
    }),
    prisma.draw.findMany({
      where: orgScope(actor),
      orderBy: { cutoffAt: "desc" },
      take: 50,
      select: { id: true, name: true },
    }),
    canSeeAllAgents
      ? prisma.agent.findMany({
          where: orgScope(actor),
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <main>
      <section className="card" aria-labelledby="bills-heading">
        <p>
          <Link href="/">← หน้าแรก</Link>
        </p>
        <h1 id="bills-heading">รายการบิล</h1>
        <p className="muted">
          {actor.role === "AGENT" ? "แสดงเฉพาะบิลของคุณ" : "แสดงบิลทั้งหมดในองค์กร"}
        </p>

        {can(actor.role, "bill.create") && (
          <p>
            <Link href="/bills/new">
              <button type="button">สร้างบิลใหม่</button>
            </Link>
          </p>
        )}

        <form method="get" className="bill-filters">
          <label htmlFor="q">
            ค้นหา
            <input
              id="q"
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="เลขบิลหรือชื่อบิล"
            />
          </label>

          <label htmlFor="draw">
            รอบ
            <select id="draw" name="draw" defaultValue={params.draw ?? ""}>
              <option value="">ทุกรอบ</option>
              {draws.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>

          {canSeeAllAgents && (
            <label htmlFor="agent">
              Agent
              <select id="agent" name="agent" defaultValue={params.agent ?? ""}>
                <option value="">ทุก Agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label htmlFor="status">
            สถานะ
            <select id="status" name="status" defaultValue={params.status ?? ""}>
              <option value="">ทุกสถานะ</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
          </label>

          <button type="submit">ค้นหา</button>
        </form>

        {bills.length === 0 ? (
          <p className="muted">ไม่พบบิลที่ตรงกับเงื่อนไข</p>
        ) : (
          <>
            <p className="muted">พบ {bills.length} บิล (แสดงสูงสุด 200)</p>
            <table>
              <thead>
                <tr>
                  <th scope="col">เลขบิล</th>
                  <th scope="col">ชื่อบิล</th>
                  <th scope="col">รอบ</th>
                  <th scope="col">Agent</th>
                  <th scope="col" className="num">รายการ</th>
                  <th scope="col" className="num">ยอดขาย</th>
                  <th scope="col" className="num">จ่ายรางวัล</th>
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
                    <td className="num">{bill._count.items}</td>
                    <td className="num">{bill.totalStake.toFixed(2)}</td>
                    <td className="num">{bill.totalPayout.toFixed(2)}</td>
                    <td>{statusLabel(bill.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}

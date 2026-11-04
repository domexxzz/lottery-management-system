import Link from "next/link";
import { redirect } from "next/navigation";
import type { BillStatus } from "@prisma/client";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { searchBills } from "@/lib/reports/service";
import { statusLabel } from "@/lib/bills/lifecycle";
import { BillFilters } from "./BillFilters";
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
    <main className="workspace-page bills-page">
      <section className="card workspace-card" aria-labelledby="bills-heading">
        <p><Link href="/">← หน้าภาพรวม</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Bill Management</p><h1 id="bills-heading">รายการบิล</h1><p>{actor.role === "AGENT" ? "ตรวจสอบและจัดการบิลของคุณ" : "จัดการบิลทั้งหมด ค้นหา กรอง และตรวจสอบสถานะ"}</p></div>{can(actor.role, "bill.create") && <Link href="/bills/new" className="page-primary-action">＋ สร้างบิลใหม่</Link>}</header>

        <div className="bill-summary-strip"><div><span>บิลที่พบ</span><strong>{bills.length}</strong></div><div><span>ยืนยันแล้ว</span><strong>{bills.filter((bill) => bill.status === "CONFIRMED").length}</strong></div><div><span>รอประมวลผล</span><strong>{bills.filter((bill) => bill.status === "LOCKED").length}</strong></div><div><span>ยอดรับแทงรวม</span><strong>{bills.reduce((sum, bill) => sum + Number(bill.totalStake), 0).toLocaleString("th-TH", { minimumFractionDigits: 2 })}</strong></div></div>

        <BillFilters
          query={params.q ?? ""}
          drawId={params.draw ?? ""}
          agentId={params.agent ?? ""}
          status={params.status ?? ""}
          draws={draws.map((draw) => ({ id: draw.id, label: draw.name }))}
          agents={
            canSeeAllAgents
              ? agents.map((agent) => ({
                  id: agent.id,
                  label: `${agent.code} ${agent.name}`,
                }))
              : null
          }
          statuses={STATUSES.map((statusOption) => ({
            id: statusOption,
            label: statusLabel(statusOption),
          }))}
        />

        {bills.length === 0 ? (
          <p className="muted">ไม่พบบิลที่ตรงกับเงื่อนไข</p>
        ) : (
          <>
            <p className="muted">พบ {bills.length} บิล (แสดงสูงสุด 200)</p>
            <div className="table-wrap"><table>
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
                    <td><span className={`status-pill ${bill.status === "CANCELLED" ? "danger" : bill.status === "DRAFT" ? "warning" : bill.status === "SETTLED" ? "success" : "info"}`}>{statusLabel(bill.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </>
        )}
      </section>
    </main>
  );
}

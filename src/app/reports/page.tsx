import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { byAgent, byPrizeType, drawSummary } from "@/lib/reports/service";
import { DrawPicker } from "./DrawPicker";
import "./reports.css";

export const dynamic = "force-dynamic";

const DRAW_STATUS: Record<string, string> = {
  OPEN: "เปิดรับ",
  LOCKED: "ปิดรับแล้ว",
  RESULT_PENDING: "รอผล",
  SETTLED: "คำนวณแล้ว",
  CLOSED: "ปิดบัญชีแล้ว",
};

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ draw?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const { draw: drawParam } = await searchParams;

  const draws = await prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: { cutoffAt: "desc" },
    take: 50,
    select: { id: true, name: true, status: true },
  });

  if (draws.length === 0) {
    return (
      <main>
        <section className="card">
          <p>
            <Link href="/">← หน้าแรก</Link>
          </p>
          <h1>รายงาน</h1>
          <p className="muted">ยังไม่มีรอบ</p>
        </section>
      </main>
    );
  }

  const selectedId = draws.some((d) => d.id === drawParam) ? drawParam! : draws[0]!.id;

  const [summary, agents, prizes] = await Promise.all([
    drawSummary(actor, selectedId),
    byAgent(actor, selectedId),
    byPrizeType(actor, selectedId),
  ]);

  return (
    <main className="workspace-page reports-page">
      <section className="card workspace-card" aria-labelledby="reports-heading">
        <p><Link href="/">← หน้าภาพรวม</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Financial Reports</p><h1 id="reports-heading">รายงาน</h1><p>สรุปยอดขาย รางวัล คอมมิชชัน และผลการดำเนินงานแต่ละรอบ</p></div><a className="page-primary-action" href={`/api/reports/${selectedId}/agents`}>↓ ดาวน์โหลดรายงาน</a></header>

        <DrawPicker
          selectedId={selectedId}
          draws={draws.map((draw) => ({
            id: draw.id,
            label: `${draw.name} — ${DRAW_STATUS[draw.status] ?? draw.status}`,
          }))}
        />

        {actor.role === "AGENT" && (
          <p className="muted">แสดงเฉพาะข้อมูลของคุณ</p>
        )}

        {summary.pendingSettlement && (
          <p className="notice">
            รอบนี้ยังไม่ได้คำนวณ Settlement ยอดจ่ายและยอดสุทธิจึงยังไม่สมบูรณ์
          </p>
        )}

        <h2>ยอดรวมของรอบ</h2>
        <dl className="kpi">
          <div>
            <dt>ยอดขาย</dt>
            <dd>{summary.gross.toFixed(2)}</dd>
          </div>
          <div>
            <dt>จ่ายรางวัล</dt>
            <dd>{summary.payout.toFixed(2)}</dd>
          </div>
          <div>
            <dt>คอมมิชชัน</dt>
            <dd>{summary.commission.toFixed(2)}</dd>
          </div>
          <div>
            <dt>สุทธิ</dt>
            <dd className={summary.net.isNegative() ? "negative" : undefined}>
              {summary.net.toFixed(2)}
            </dd>
          </div>
          <div>
            <dt>บิล</dt>
            <dd>{summary.billCount}</dd>
          </div>
          <div>
            <dt>รายการ</dt>
            <dd>{summary.itemCount}</dd>
          </div>
        </dl>

        <h2>แยกตาม Agent</h2>
        <p>
          <a href={`/api/reports/${selectedId}/agents`}>ดาวน์โหลด CSV</a>
        </p>
        {agents.length === 0 ? (
          <p className="muted">ไม่มีข้อมูล</p>
        ) : (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th scope="col">Agent</th>
                <th scope="col" className="num">บิล</th>
                <th scope="col" className="num">ยอดขาย</th>
                <th scope="col" className="num">จ่ายรางวัล</th>
                <th scope="col" className="num">คอม</th>
                <th scope="col" className="num">สุทธิ</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.agentCode}>
                  <td>
                    {a.agentCode} {a.agentName}
                  </td>
                  <td className="num">{a.billCount}</td>
                  <td className="num">{a.gross.toFixed(2)}</td>
                  <td className="num">{a.payout.toFixed(2)}</td>
                  <td className="num">{a.commission.toFixed(2)}</td>
                  <td className={a.net.isNegative() ? "num negative" : "num"}>
                    {a.net.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}

        <h2>แยกตามประเภทรางวัล</h2>
        <p>
          <a href={`/api/reports/${selectedId}/prize-types`}>ดาวน์โหลด CSV</a>
        </p>
        {prizes.length === 0 ? (
          <p className="muted">ไม่มีข้อมูล</p>
        ) : (
          <div className="table-wrap"><table>
            <thead>
              <tr>
                <th scope="col">รางวัล</th>
                <th scope="col" className="num">รายการ</th>
                <th scope="col" className="num">ถูกรางวัล</th>
                <th scope="col" className="num">ยอดขาย</th>
                <th scope="col" className="num">จ่ายรางวัล</th>
              </tr>
            </thead>
            <tbody>
              {prizes.map((p) => (
                <tr key={p.code}>
                  <td>
                    {p.code}. {p.name}
                  </td>
                  <td className="num">{p.itemCount}</td>
                  <td className="num">{p.winnerCount}</td>
                  <td className="num">{p.gross.toFixed(2)}</td>
                  <td className="num">{p.payout.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { byAgent, byPrizeType, drawSummary } from "@/lib/reports/service";
import { DrawPicker } from "./DrawPicker";
import { AgentReports } from "./AgentReports";
import { ReportChart } from "./ReportChart";
import "./reports.css";

export const dynamic = "force-dynamic";

const DRAW_STATUS: Record<string, string> = {
  ALL: "รวมทุกงวด",
  OPEN: "เปิดรับ",
  LOCKED: "ปิดรับแล้ว",
  RESULT_PENDING: "รอผล",
  SETTLED: "คำนวณแล้ว",
  CLOSED: "ปิดบัญชีแล้ว",
};

const money = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ draw?: string; dateFrom?: string; dateTo?: string; settlement?: string; view?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const query = await searchParams;
  const { draw: drawParam } = query;

  if (actor.role === "AGENT") {
    return <AgentReports actor={actor} filters={{ drawId: query.draw, dateFrom: query.dateFrom, dateTo: query.dateTo, settlement: query.settlement, view: query.view }} />;
  }

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
          <p className="muted">ยังไม่มีงวด</p>
        </section>
      </main>
    );
  }

  const selectedDrawId = draws.some((draw) => draw.id === drawParam) ? drawParam : undefined;
  const selectedId = selectedDrawId ?? "all";

  const [summary, agents, prizes] = await Promise.all([
    drawSummary(actor, selectedDrawId),
    byAgent(actor, selectedDrawId),
    byPrizeType(actor, selectedDrawId),
  ]);

  const winnerCount = prizes.reduce((total, prize) => total + prize.winnerCount, 0);
  const topAgents = [...agents].sort((a, b) => b.gross.comparedTo(a.gross)).slice(0, 5);
  const topPrize = [...prizes].sort((a, b) => b.gross.comparedTo(a.gross))[0];
  const payoutRatio = summary.gross.isZero() ? 0 : summary.payout.dividedBy(summary.gross).times(100).toNumber();
  const selectedDraw = selectedDrawId ? draws.find((draw) => draw.id === selectedDrawId) : undefined;
  const selectedStatus = selectedDraw?.status ?? "ALL";
  const scopeLabel = selectedDraw?.name ?? "ทุกงวด";

  return (
    <main className="workspace-page reports-page">
      <section className="card workspace-card report-workspace" aria-labelledby="reports-heading">
        <Link className="report-back" href="/">← หน้าภาพรวม</Link>
        <header className="report-hero">
          <div>
            <p className="page-eyebrow">EXECUTIVE REPORT CENTER</p>
            <h1 id="reports-heading">รายงานการดำเนินงาน</h1>
            <p>เห็นยอดสำคัญ แนวโน้ม และจุดที่ควรตรวจสอบได้ในหน้าเดียว</p>
          </div>
          <div className="report-hero-actions">
            <span className={`report-draw-status status-${selectedStatus.toLowerCase()}`}>
              <i /> {DRAW_STATUS[selectedStatus] ?? selectedStatus}
            </span>
            <a className="page-primary-action" href={`/api/reports/${selectedId}/agents`}>ดาวน์โหลด CSV ↓</a>
          </div>
        </header>

        <div className="report-filter-bar">
          <div><span className="report-kicker">ตัวกรองข้อมูล</span><strong>เลือกทุกงวดหรืองวดที่ต้องการดู</strong></div>
          <DrawPicker selectedId={selectedId} draws={draws.map((draw) => ({ id: draw.id, label: `${draw.name} — ${DRAW_STATUS[draw.status] ?? draw.status}` }))} />
          <span className="report-auto-filter"><i /> อัปเดตอัตโนมัติเมื่อเลือก</span>
        </div>

        {summary.pendingSettlement && <p className="notice report-notice"><b>ข้อมูลยังไม่สมบูรณ์</b> งวดนี้ยังไม่ได้คำนวณผล ยอดจ่ายและยอดสุทธิอาจเปลี่ยนแปลง</p>}

        <section className="report-kpi-grid" aria-label="ตัวเลขสรุป">
          <a href="#agent-report"><span className="kpi-icon teal">฿</span><span><small>ยอดขายรวม</small><strong>{money.format(summary.gross.toNumber())}</strong><em>บาท · {scopeLabel}</em></span></a>
          <a href="#prize-report"><span className="kpi-icon amber">↘</span><span><small>จ่ายรางวัล</small><strong>{money.format(summary.payout.toNumber())}</strong><em>{payoutRatio.toFixed(1)}% ของยอดขาย</em></span></a>
          <a href="#agent-report"><span className="kpi-icon violet">%</span><span><small>คอมมิชชัน</small><strong>{money.format(summary.commission.toNumber())}</strong><em>บาท · Agent {agents.length} คน</em></span></a>
          <a href="#insights"><span className="kpi-icon green">↗</span><span><small>ยอดสุทธิ</small><strong className={summary.net.isNegative() ? "negative" : undefined}>{money.format(summary.net.toNumber())}</strong><em>หลังหักรางวัลและคอม</em></span></a>
          <a href="#agent-report"><span className="kpi-icon blue">▤</span><span><small>จำนวนบิล</small><strong>{summary.billCount.toLocaleString("th-TH")}</strong><em>{summary.itemCount.toLocaleString("th-TH")} รายการ</em></span></a>
          <a href="#prize-report"><span className="kpi-icon gold">★</span><span><small>รายการถูกรางวัล</small><strong>{winnerCount.toLocaleString("th-TH")}</strong><em>จากข้อมูลที่คำนวณแล้ว</em></span></a>
        </section>

        <div className="report-main-grid">
          <ReportChart rows={agents.map((a) => ({ code: a.agentCode, name: a.agentName, gross: a.gross.toNumber(), payout: a.payout.toNumber(), net: a.net.toNumber(), bills: a.billCount }))} />
          <aside id="insights" className="report-panel report-insights">
            <div className="report-panel-heading"><div><span className="report-kicker">SMART SUMMARY</span><h2>สิ่งที่ควรรู้ทันที</h2><p>สรุปจากข้อมูลจริงของงวดนี้</p></div></div>
            <ul>
              <li><span className="insight-dot teal" /><div><b>{topAgents[0] ? `${topAgents[0].agentCode} มียอดขายสูงสุด` : "ยังไม่มีข้อมูล Agent"}</b><small>{topAgents[0] ? `${money.format(topAgents[0].gross.toNumber())} บาท` : "เพิ่มบิลเพื่อเริ่มสรุปผล"}</small></div></li>
              <li><span className="insight-dot amber" /><div><b>อัตราจ่ายรางวัล {payoutRatio.toFixed(1)}%</b><small>คิดจากยอดจ่ายเทียบกับยอดขาย</small></div></li>
              <li><span className="insight-dot violet" /><div><b>{topPrize ? `${topPrize.name} มียอดเดิมพันสูงสุด` : "ยังไม่มีข้อมูลประเภทรางวัล"}</b><small>{topPrize ? `${money.format(topPrize.gross.toNumber())} บาท · ${topPrize.itemCount} รายการ` : "รอข้อมูลรายการบิล"}</small></div></li>
              <li><span className={`insight-dot ${summary.pendingSettlement ? "red" : "green"}`} /><div><b>{summary.pendingSettlement ? "งวดนี้ยังรอคำนวณผล" : "ข้อมูลการเงินคำนวณแล้ว"}</b><small>{summary.pendingSettlement ? "ยอดสุทธิยังไม่ใช่ตัวเลขสุดท้าย" : "พร้อมตรวจสอบรายละเอียดด้านล่าง"}</small></div></li>
            </ul>
          </aside>
        </div>

        <section id="agent-report" className="report-panel report-table-panel">
          <div className="report-panel-heading"><div><span className="report-kicker">AGENT PERFORMANCE</span><h2>ผลงาน Agent</h2><p>แสดง 5 อันดับแรกตามยอดขาย กดชื่อเพื่อดูโปรไฟล์เชิงลึก</p></div><a href={`/api/reports/${selectedId}/agents`}>ดาวน์โหลด CSV ↓</a></div>
          {topAgents.length === 0 ? <div className="report-empty">ยังไม่มีข้อมูล Agent ในงวดนี้</div> : <div className="table-wrap"><table className="report-table"><thead><tr><th>อันดับ</th><th>Agent</th><th className="num">บิล</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th className="num">คอมมิชชัน</th><th className="num">สุทธิ</th></tr></thead><tbody>{topAgents.map((a, index) => <tr key={a.agentCode}><td><span className="table-rank">{index + 1}</span></td><td><Link className="agent-link" href={`/agents/${a.agentId}`}><b>{a.agentCode}</b><small>{a.agentName}</small></Link></td><td className="num">{a.billCount}</td><td className="num"><b>{money.format(a.gross.toNumber())}</b></td><td className="num">{money.format(a.payout.toNumber())}</td><td className="num">{money.format(a.commission.toNumber())}</td><td className={a.net.isNegative() ? "num negative" : "num positive"}>{money.format(a.net.toNumber())}</td></tr>)}</tbody></table></div>}
          {agents.length > 5 && <p className="report-table-note">แสดง 5 จาก {agents.length} Agent · ดาวน์โหลด CSV เพื่อดูข้อมูลทั้งหมด</p>}
        </section>

        <section id="prize-report" className="report-panel report-table-panel">
          <div className="report-panel-heading"><div><span className="report-kicker">PRIZE BREAKDOWN</span><h2>รายละเอียดตามประเภทรางวัล</h2><p>เปรียบเทียบจำนวนรายการ ผู้ถูกรางวัล และยอดเงินของแต่ละประเภท</p></div><a href={`/api/reports/${selectedId}/prize-types`}>ดาวน์โหลด CSV ↓</a></div>
          {prizes.length === 0 ? <div className="report-empty">ยังไม่มีข้อมูลประเภทรางวัลในงวดนี้</div> : <div className="table-wrap"><table className="report-table"><thead><tr><th>ประเภทรางวัล</th><th className="num">รายการ</th><th className="num">ถูกรางวัล</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th className="num">อัตราจ่าย</th></tr></thead><tbody>{prizes.map((p) => { const ratio = p.gross.isZero() ? 0 : p.payout.dividedBy(p.gross).times(100).toNumber(); return <tr key={p.code}><td><span className="prize-code">{p.code}</span><b>{p.name}</b></td><td className="num">{p.itemCount}</td><td className="num">{p.winnerCount}</td><td className="num"><b>{money.format(p.gross.toNumber())}</b></td><td className="num">{money.format(p.payout.toNumber())}</td><td className="num"><span className={`ratio-badge ${ratio > 100 ? "high" : ""}`}>{ratio.toFixed(1)}%</span></td></tr>; })}</tbody></table></div>}
        </section>
      </section>
    </main>
  );
}

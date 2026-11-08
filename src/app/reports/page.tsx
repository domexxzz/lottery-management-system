import type { CSSProperties } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { byAgent, byDraw, byPrizeType, drawSummary } from "@/lib/reports/service";
import { DrawPicker } from "./DrawPicker";
import { AgentReports } from "./AgentReports";
import { ReportFinancialCharts } from "./ReportFinancialCharts";
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
const reportDate = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
const reportDateTime = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });

function percentChange(current?: number, previous?: number) {
  if (current === undefined || previous === undefined || previous === 0) return null;
  return (current - previous) / Math.abs(previous) * 100;
}

function changeLabel(change: number | null) {
  if (change === null) return "ยังไม่มีงวดก่อนหน้า";
  return `${change >= 0 ? "↑" : "↓"} ${Math.abs(change).toFixed(1)}% จากงวดก่อน`;
}

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
    select: { id: true, name: true, status: true, updatedAt: true },
  });

  if (draws.length === 0) {
    return <main><section className="card"><p><Link href="/">← หน้าแรก</Link></p><h1>รายงาน</h1><p className="muted">ยังไม่มีงวด</p></section></main>;
  }

  const selectedDrawId = draws.some((draw) => draw.id === drawParam) ? drawParam : undefined;
  const selectedId = selectedDrawId ?? "all";
  const [summary, agents, prizes, drawRows] = await Promise.all([
    drawSummary(actor, selectedDrawId),
    byAgent(actor, selectedDrawId),
    byPrizeType(actor, selectedDrawId),
    byDraw(actor, selectedDrawId),
  ]);
  const trendRows = selectedDrawId ? await byDraw(actor) : drawRows;

  const winnerCount = prizes.reduce((total, prize) => total + prize.winnerCount, 0);
  const topAgents = [...agents].sort((a, b) => b.gross.comparedTo(a.gross)).slice(0, 5);
  const topPrize = [...prizes].sort((a, b) => b.gross.comparedTo(a.gross))[0];
  const payoutRatio = summary.gross.isZero() ? 0 : summary.payout.dividedBy(summary.gross).times(100).toNumber();
  const selectedDraw = selectedDrawId ? draws.find((draw) => draw.id === selectedDrawId) : undefined;
  const selectedStatus = selectedDraw?.status ?? "ALL";
  const scopeLabel = selectedDraw?.name ?? "ทุกงวด";
  const drawStatusById = new Map(draws.map((draw) => [draw.id, draw.status]));
  const latestDraws = [...drawRows].reverse().slice(0, 6);
  const prizeStats = [...prizes].sort((a, b) => b.itemCount - a.itemCount);
  const maxPrizeItems = Math.max(...prizeStats.map((prize) => prize.itemCount), 1);
  const payoutRing = Math.min(Math.max(payoutRatio, 0), 100);
  const payoutRingStyle = { "--report-ring": `${payoutRing}%` } as CSSProperties;
  const comparisonIndex = selectedDrawId
    ? trendRows.findIndex((draw) => draw.drawId === selectedDrawId)
    : trendRows.length - 1;
  const comparisonCurrent = comparisonIndex >= 0 ? trendRows[comparisonIndex] : undefined;
  const comparisonPrevious = comparisonIndex > 0 ? trendRows[comparisonIndex - 1] : undefined;
  const grossChange = percentChange(comparisonCurrent?.gross.toNumber(), comparisonPrevious?.gross.toNumber());
  const payoutChange = percentChange(comparisonCurrent?.payout.toNumber(), comparisonPrevious?.payout.toNumber());
  const netChange = percentChange(comparisonCurrent?.net.toNumber(), comparisonPrevious?.net.toNumber());
  const worstDraw = trendRows.reduce<(typeof trendRows)[number] | undefined>((worst, draw) => !worst || draw.net.lessThan(worst.net) ? draw : worst, undefined);
  const largestPayoutPrize = [...prizes].sort((a, b) => b.payout.comparedTo(a.payout))[0];
  const closedDrawCount = draws.filter((draw) => draw.status === "SETTLED" || draw.status === "CLOSED").length;
  const pendingDrawCount = draws.length - closedDrawCount;
  const lastUpdatedAt = draws.reduce((latest, draw) => draw.updatedAt > latest ? draw.updatedAt : latest, draws[0]!.updatedAt);
  const healthTone = summary.net.isNegative() ? "critical" : payoutRatio > 80 ? "warning" : "healthy";
  const healthLabel = summary.net.isNegative() ? "ขาดทุน — ต้องตรวจสอบ" : payoutRatio > 80 ? "กำไรต่ำ — ควรเฝ้าระวัง" : "สถานะปกติ";
  const healthAmount = `${money.format(summary.net.abs().toNumber())}\u00a0บาท`;
  const healthDetail = largestPayoutPrize
    ? `ประเภทรางวัลที่มีภาระจ่ายสูงสุดคือ ${largestPayoutPrize.name} จำนวน ${money.format(largestPayoutPrize.payout.toNumber())} บาท${worstDraw && worstDraw.net.isNegative() ? ` และงวดที่ติดลบสูงสุดคือ ${worstDraw.drawName}` : ""}`
    : "ยังไม่มีข้อมูลประเภทรางวัลเพียงพอสำหรับวิเคราะห์สาเหตุ";
  const attentionItems = [
    {
      tone: payoutRatio > 100 ? "critical" : payoutRatio > 80 ? "warning" : "info",
      title: "อัตราจ่ายรางวัล",
      detail: `${payoutRatio.toFixed(1)}% ของยอดรับแทง${payoutRatio > 100 ? " — สูงกว่ายอดรับแทง" : ""}`,
      href: "#financial-trends",
    },
    {
      tone: worstDraw?.net.isNegative() ? "critical" : "info",
      title: worstDraw?.net.isNegative() ? "งวดที่ขาดทุนสูงสุด" : "งวดที่ควรตรวจ",
      detail: worstDraw ? `${worstDraw.drawName} · สุทธิ ${money.format(worstDraw.net.toNumber())} บาท` : "ยังไม่มีข้อมูลรายงวด",
      href: worstDraw ? `/draws/${worstDraw.drawId}` : "/draws",
    },
    {
      tone: pendingDrawCount > 0 ? "warning" : "healthy",
      title: pendingDrawCount > 0 ? "งวดยังไม่ปิดบัญชี" : "ข้อมูลปิดบัญชีครบ",
      detail: pendingDrawCount > 0 ? `${pendingDrawCount.toLocaleString("th-TH")} จาก ${draws.length.toLocaleString("th-TH")} งวดล่าสุด` : `${closedDrawCount.toLocaleString("th-TH")} งวดล่าสุดคำนวณครบแล้ว`,
      href: "/draws",
    },
  ];

  return (
    <main className="workspace-page reports-page reports-page--blue">
      <section className="card workspace-card report-workspace report-workspace--blue" aria-labelledby="reports-heading">
        <Link className="report-back" href="/">⌂ ภาพรวม</Link>
        <header className="report-hero report-hero--blue">
          <div><p className="page-eyebrow">LOTTERY ANALYTICS CENTER</p><h1 id="reports-heading">รายงานและสถิติ<span>การดำเนินงาน</span></h1><p>ติดตามยอดรับแทง เงินรางวัล และผลประกอบการจากข้อมูลจริงในมุมมองเดียว</p></div>
          <div className="report-hero-actions"><span className={`report-draw-status status-${selectedStatus.toLowerCase()}`}><i /> {DRAW_STATUS[selectedStatus] ?? selectedStatus}</span><a className="page-primary-action" href={`/api/reports/${selectedId}/agents`}>ดาวน์โหลด CSV ↓</a></div>
        </header>

        <div className="report-filter-bar report-filter-bar--glass">
          <div><span className="report-kicker">ช่วงข้อมูลที่แสดง</span><strong>เลือกงวดเพื่อดูรายละเอียดเฉพาะช่วง</strong></div>
          <DrawPicker selectedId={selectedId} draws={draws.map((draw) => ({ id: draw.id, label: `${draw.name} — ${DRAW_STATUS[draw.status] ?? draw.status}` }))} />
          <span className="report-auto-filter"><i /> ข้อมูลจริงจากระบบ</span>
        </div>
        {summary.pendingSettlement && <p className="notice report-notice"><b>ข้อมูลยังไม่สมบูรณ์</b> งวดนี้ยังไม่ได้คำนวณผล ยอดจ่ายและยอดสุทธิอาจเปลี่ยนแปลง</p>}

        <section className={`report-health-panel report-health-panel--${healthTone}`} aria-labelledby="business-health-heading">
          <div className="report-health-main">
            <span className="report-health-icon" aria-hidden="true">{healthTone === "critical" ? "!" : healthTone === "warning" ? "△" : "✓"}</span>
            <div><span className="report-health-status">{healthLabel}</span><h2 id="business-health-heading"><span>{summary.net.isNegative() ? "ขาดทุนสุทธิ" : "กำไรสุทธิ"}</span> <strong>{healthAmount}</strong></h2><p>{healthDetail}</p></div>
          </div>
          <dl className="report-health-facts">
            <div><dt>อัปเดตข้อมูลล่าสุด</dt><dd>{reportDateTime.format(lastUpdatedAt)} น.</dd></div>
            <div><dt>ปิดบัญชีแล้ว</dt><dd>{closedDrawCount.toLocaleString("th-TH")} / {draws.length.toLocaleString("th-TH")} งวดล่าสุด</dd></div>
            <div><dt>ยังไม่ปิดบัญชี</dt><dd className={pendingDrawCount > 0 ? "warning" : undefined}>{pendingDrawCount.toLocaleString("th-TH")} งวด</dd></div>
          </dl>
          <a href="#report-attention">ดูสิ่งที่ต้องตรวจทันที ↓</a>
        </section>

        <section className="report-kpi-grid report-kpi-grid--primary" aria-label="สรุปตัวเลขการเงิน">
          <a className="report-kpi-card report-kpi-card--gross" href="#financial-trends"><span className="report-kpi-icon" aria-hidden="true">▣</span><span><small>ยอดรับแทงรวม</small><strong>{money.format(summary.gross.toNumber())}&nbsp;บาท</strong><em>{scopeLabel}</em><span className={`report-kpi-change ${grossChange !== null && grossChange < 0 ? "negative" : "positive"}`}>{changeLabel(grossChange)}</span></span></a>
          <a className="report-kpi-card report-kpi-card--payout" href="#financial-trends"><span className="report-kpi-icon" aria-hidden="true">♛</span><span><small>จ่ายรางวัลรวม</small><strong>{money.format(summary.payout.toNumber())}&nbsp;บาท</strong><em>{payoutRatio.toFixed(1)}% ของยอดรับแทง</em><span className={`report-kpi-change ${payoutChange !== null && payoutChange > 0 ? "negative" : "positive"}`}>{changeLabel(payoutChange)}</span></span></a>
          <a className="report-kpi-card report-kpi-card--net" href="#financial-trends"><span className="report-kpi-icon" aria-hidden="true">▥</span><span><small>ยอดสุทธิ</small><strong className={summary.net.isNegative() ? "negative" : undefined}>{money.format(summary.net.toNumber())}&nbsp;บาท</strong><em>หลังหักรางวัลและคอมมิชชัน</em><span className={`report-kpi-change ${netChange !== null && netChange < 0 ? "negative" : "positive"}`}>{changeLabel(netChange)}</span></span></a>
        </section>

        <section id="report-attention" className="report-attention-panel" aria-labelledby="report-attention-heading">
          <header><div><span className="report-attention-icon" aria-hidden="true">⌁</span><span><span className="report-kicker">ACTION REQUIRED</span><h2 id="report-attention-heading">สิ่งที่ต้องตรวจทันที</h2></span></div><small>จัดลำดับจากข้อมูลจริงของ {scopeLabel}</small></header>
          <div>{attentionItems.map((item, index) => <a href={item.href} className={`report-attention-item report-attention-item--${item.tone}`} key={item.title}><span>{index + 1}</span><div><b>{item.title}</b><small>{item.detail}</small></div><i aria-hidden="true">→</i></a>)}</div>
        </section>

        <ReportFinancialCharts id="financial-trends" rows={drawRows.map((draw) => ({
          id: draw.drawId,
          label: new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" }).format(draw.cutoffAt),
          name: draw.drawName,
          gross: draw.gross.toNumber(),
          payout: draw.payout.toNumber(),
          net: draw.net.toNumber(),
        }))} />

        <section className="report-snapshot-grid" aria-label="งวดล่าสุดและสรุปภาพรวม">
          <article className="report-panel report-latest-draws">
            <div className="report-panel-heading"><div><span className="report-section-icon" aria-hidden="true">▤</span><span><h2>รายการงวดล่าสุด</h2><p>ผลการดำเนินงานล่าสุดจากข้อมูลจริง</p></span></div><Link href="/draws">ดูรายการทั้งหมด →</Link></div>
            {latestDraws.length === 0 ? <div className="report-empty">ยังไม่มีข้อมูลรายงวด</div> : <div className="table-wrap"><table className="report-table report-table--latest"><thead><tr><th>งวด</th><th>วันที่ออกรางวัล</th><th className="num">ยอดรับแทง</th><th>สถานะ</th></tr></thead><tbody>{latestDraws.map((draw) => { const status = drawStatusById.get(draw.drawId) ?? "ALL"; return <tr key={draw.drawId}><td><Link href={`/draws/${draw.drawId}`}><b>{draw.drawName}</b></Link></td><td>{reportDate.format(draw.cutoffAt)}</td><td className="num"><b>{money.format(draw.gross.toNumber())}</b></td><td><span className={`report-status-pill status-${status.toLowerCase()}`}>{DRAW_STATUS[status] ?? status}</span></td></tr>; })}</tbody></table></div>}
          </article>

          <article id="insights" className="report-panel report-overview-card">
            <div className="report-panel-heading"><div><span className="report-section-icon" aria-hidden="true">▦</span><span><h2>สรุปภาพรวม</h2><p>สัดส่วนและตัวเลขสำคัญของ {scopeLabel}</p></span></div></div>
            <div className="report-overview-content"><div className="report-ratio-ring" style={payoutRingStyle}><div><strong>{payoutRatio.toFixed(1)}%</strong><span>อัตราจ่ายรางวัล</span></div></div><dl className="report-overview-values"><div><dt><i className="gross" />ยอดรับแทง</dt><dd>{money.format(summary.gross.toNumber())}&nbsp;บาท</dd></div><div><dt><i className="payout" />จ่ายรางวัล</dt><dd>{money.format(summary.payout.toNumber())}&nbsp;บาท</dd></div><div><dt><i className="net" />ยอดสุทธิ</dt><dd className={summary.net.isNegative() ? "negative" : undefined}>{money.format(summary.net.toNumber())}&nbsp;บาท</dd></div></dl></div>
            <div className="report-overview-meta"><span><b>{summary.billCount.toLocaleString("th-TH")}</b> บิล</span><span><b>{summary.itemCount.toLocaleString("th-TH")}</b> รายการ</span><span><b>{winnerCount.toLocaleString("th-TH")}</b> รายการถูกรางวัล</span></div>
            <div className="report-overview-note"><span aria-hidden="true">☼</span><div><b>ข้อมูลที่ควรรู้</b><small>{topPrize ? `${topPrize.name} มียอดรับแทงสูงสุด ${money.format(topPrize.gross.toNumber())} บาท` : "ยังไม่มีข้อมูลประเภทรางวัล"}</small></div></div>
          </article>
        </section>

        <section id="prize-report" className="report-panel report-table-panel report-statistics-panel">
          <div className="report-panel-heading"><div><span className="report-section-icon report-section-icon--amber" aria-hidden="true">♛</span><span><span className="report-kicker">PRIZE STATISTICS</span><h2>สถิติประเภทรางวัล</h2><p>จัดอันดับจากจำนวนรายการ พร้อมยอดรับแทง ยอดจ่าย และอัตราจ่ายจริง</p></span></div><a href={`/api/reports/${selectedId}/prize-types`}>ดาวน์โหลด CSV ↓</a></div>
          {prizeStats.length === 0 ? <div className="report-empty">ยังไม่มีข้อมูลประเภทรางวัลในงวดนี้</div> : <div className="table-wrap"><table className="report-table report-table--statistics"><thead><tr><th>อันดับ</th><th>ประเภทรางวัล</th><th className="num">จำนวนรายการ</th><th className="num">ถูกรางวัล</th><th className="num">ยอดรับแทง</th><th className="num">จ่ายรางวัล</th><th>สัดส่วนรายการ</th><th>สถานะ</th></tr></thead><tbody>{prizeStats.map((prize, index) => { const ratio = prize.gross.isZero() ? 0 : prize.payout.dividedBy(prize.gross).times(100).toNumber(); const itemShare = prize.itemCount / maxPrizeItems * 100; return <tr key={prize.code}><td><span className="table-rank">{index + 1}</span></td><td><span className="prize-code">{prize.code}</span><b>{prize.name}</b></td><td className="num"><b>{prize.itemCount.toLocaleString("th-TH")}</b></td><td className="num">{prize.winnerCount.toLocaleString("th-TH")}</td><td className="num">{money.format(prize.gross.toNumber())}</td><td className="num">{money.format(prize.payout.toNumber())}</td><td><span className="report-stat-progress"><i style={{ width: `${itemShare}%` }} /></span></td><td><span className={`ratio-badge ${ratio > 100 ? "high" : ""}`}>{ratio.toFixed(1)}%</span></td></tr>; })}</tbody></table></div>}
        </section>

        <section id="agent-report" className="report-panel report-table-panel report-agent-panel">
          <div className="report-panel-heading"><div><span className="report-section-icon" aria-hidden="true">♙</span><span><span className="report-kicker">AGENT PERFORMANCE</span><h2>ผลงาน Agent</h2><p>5 อันดับแรกตามยอดรับแทง กดชื่อเพื่อดูรายละเอียด</p></span></div><a href={`/api/reports/${selectedId}/agents`}>ดาวน์โหลด CSV ↓</a></div>
          {topAgents.length === 0 ? <div className="report-empty">ยังไม่มีข้อมูล Agent ในงวดนี้</div> : <div className="table-wrap"><table className="report-table"><thead><tr><th>อันดับ</th><th>Agent</th><th className="num">บิล</th><th className="num">ยอดรับแทง</th><th className="num">จ่ายรางวัล</th><th className="num">คอมมิชชัน</th><th className="num">สุทธิ</th></tr></thead><tbody>{topAgents.map((agent, index) => <tr key={agent.agentCode}><td><span className="table-rank">{index + 1}</span></td><td><Link className="agent-link" href={`/agents/${agent.agentId}`}><b>{agent.agentCode}</b><small>{agent.agentName}</small></Link></td><td className="num">{agent.billCount}</td><td className="num"><b>{money.format(agent.gross.toNumber())}</b></td><td className="num">{money.format(agent.payout.toNumber())}</td><td className="num">{money.format(agent.commission.toNumber())}</td><td className={agent.net.isNegative() ? "num negative" : "num positive"}>{money.format(agent.net.toNumber())}</td></tr>)}</tbody></table></div>}
          {agents.length > 5 && <p className="report-table-note">แสดง 5 จาก {agents.length} Agent · ดาวน์โหลด CSV เพื่อดูข้อมูลทั้งหมด</p>}
        </section>
      </section>
    </main>
  );
}

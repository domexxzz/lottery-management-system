import Link from "next/link";
import "./reports.css";
import type { Actor } from "@/lib/auth/context";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { customerProfileKey } from "@/lib/customers/profile-key";
import { getSimpleAgentReport, type SimpleAgentRound } from "@/lib/reports/agent-report";
import { SimpleAgentChart, SimpleAgentDrawPicker } from "./SimpleAgentChart";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });

function changePercent(current: number, previous: number) {
  if (previous === 0) return null;
  return (current - previous) / previous * 100;
}

function RoundCard({ round, period, current }: { round: SimpleAgentRound; period: string; current?: boolean }) {
  return <article className={`agent-simple-round ${current ? "is-current" : ""}`}>
    <header><span>{period}</span><div><h2>{round.drawName}</h2><p>ปิดรับ {DATE.format(round.cutoffAt)}</p></div></header>
    <dl>
      <div><dt>ยอดขาย</dt><dd>{MONEY.format(Number(round.gross))} <small>บาท</small></dd></div>
      <div><dt>ค่าคอม</dt><dd>{MONEY.format(Number(round.commission))} <small>บาท</small></dd><em>{round.commissionFinal ? "ยอดคำนวณแล้ว" : "ประมาณการจากยอดขาย"}</em></div>
      <div><dt>บิลทั้งหมด</dt><dd>{round.billCount.toLocaleString("th-TH")} <small>บิล</small></dd></div>
      <div><dt>ถูกรางวัล</dt><dd className={round.winnerCount > 0 ? "winner" : undefined}>{round.winnerCount.toLocaleString("th-TH")} <small>รายการ</small></dd></div>
    </dl>
    {round.winnerCount > 0 && <a href="#winning-bills">ดูผู้ถูกรางวัลในงวดนี้ ↓</a>}
  </article>;
}

export async function AgentReports({ actor, selectedDrawId }: { actor: Actor; selectedDrawId?: string }) {
  const report = await getSimpleAgentReport(actor, selectedDrawId);
  const current = report.rounds[0];
  const previous = report.rounds[1];
  const customSelection = Boolean(selectedDrawId && selectedDrawId === report.selectedDrawId);
  const currentLabel = customSelection ? "งวดที่เลือก" : "งวดนี้";
  const previousLabel = customSelection ? "งวดก่อนหน้า" : "งวดที่แล้ว";
  const salesChange = current && previous ? changePercent(Number(current.gross), Number(previous.gross)) : null;
  const chartRows = [...report.rounds].reverse().map((round, index) => ({
    id: round.drawId,
    period: report.rounds.length === 1 || index === 1 ? currentLabel : previousLabel,
    name: round.drawName,
    gross: Number(round.gross),
    commission: Number(round.commission),
  }));

  return <main className="agent-reports-page agent-simple-report">
    <header className="agent-simple-hero">
      <div><p className="page-eyebrow">MY SALES REPORT</p><h1>รายงานของฉัน</h1><p>ดูยอดขาย ค่าคอม และผู้ถูกรางวัลของ 2 งวดล่าสุด</p></div>
      <div className="agent-simple-identity"><span>Agent</span><strong>{report.agent.code}</strong><small>{report.agent.name}</small></div>
    </header>

    <SimpleAgentDrawPicker
      options={report.drawOptions.map((draw) => ({ id: draw.id, name: draw.name }))}
      value={customSelection ? report.selectedDrawId : ""}
      latestName={report.drawOptions[0]?.name ?? ""}
    />

    {current ? <>
      <section className="agent-simple-kpis" aria-label="สรุปงวดล่าสุด">
        <div><span>ยอดขาย{currentLabel}</span><strong>{MONEY.format(Number(current.gross))}</strong><small>บาท</small></div>
        <div><span>ค่าคอม{currentLabel}</span><strong>{MONEY.format(Number(current.commission))}</strong><small>บาท {current.commissionFinal ? "· คำนวณแล้ว" : "· ประมาณการ"}</small></div>
        <div><span>เทียบ{previousLabel}</span><strong className={salesChange !== null && salesChange < 0 ? "down" : "up"}>{salesChange === null ? "—" : `${salesChange >= 0 ? "+" : ""}${salesChange.toFixed(1)}%`}</strong><small>{salesChange === null ? "ยังไม่มีข้อมูลให้เทียบ" : "จากยอดขาย"}</small></div>
        <div><span>ผู้ถูกรางวัล 2 งวด</span><strong>{report.winners.length.toLocaleString("th-TH")}</strong><small>บิล</small></div>
      </section>

      <section className="agent-simple-rounds">
        <RoundCard round={current} period={currentLabel} current />
        {previous ? <RoundCard round={previous} period={previousLabel} /> : <article className="agent-simple-round is-empty"><h2>{previousLabel}</h2><p>ยังไม่มีงวดก่อนหน้าให้เปรียบเทียบ</p></article>}
      </section>

      <SimpleAgentChart rows={chartRows} />

      <section className="agent-simple-winners" id="winning-bills">
        <header><div><p className="page-eyebrow">WINNING CUSTOMERS</p><h2>ใครถูกรางวัล</h2><p>แสดงบิลถูกรางวัลจากงวดนี้และงวดที่แล้ว</p></div><span>{report.winners.length.toLocaleString("th-TH")} บิล</span></header>
        {report.winners.length === 0 ? <div className="agent-simple-empty"><span>✓</span><strong>ยังไม่มีบิลถูกรางวัล</strong><p>เมื่อมีการตรวจผล รายชื่อผู้ถูกรางวัลจะแสดงตรงนี้</p></div> : <div className="agent-simple-winner-list">{report.winners.map((bill) => <article key={bill.id}>
          <div className="agent-simple-winner-rank">★</div>
          <div><small>{bill.draw.name}</small><h3><Link href={`/customers/${customerProfileKey(bill.title)}`}>{bill.title}</Link></h3><p>บิล {visibleBillNumber(bill.drawSequence)} · เดิมพัน {MONEY.format(Number(bill.totalStake))} บาท</p></div>
          <div className="agent-simple-prize"><span>เงินรางวัล</span><strong>{MONEY.format(Number(bill.totalPayout))}</strong><small>บาท</small></div>
          <Link className="agent-simple-detail" href={`/bills/${bill.id}`}>ดูบิล →</Link>
        </article>)}</div>}
      </section>
    </> : <section className="agent-simple-empty agent-simple-no-draw"><span>▥</span><strong>ยังไม่มีงวดสำหรับแสดงรายงาน</strong><p>เมื่อสร้างงวดและมีรายการบิลแล้ว ข้อมูลจะปรากฏที่นี่</p></section>}
  </main>;
}

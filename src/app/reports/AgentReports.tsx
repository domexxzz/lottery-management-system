import Link from "next/link";
import "./reports.css";
import type { Actor } from "@/lib/auth/context";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { betStatusOf } from "@/lib/bills/betting";
import { getSimpleAgentReport, type SimpleAgentBillFilter } from "@/lib/reports/agent-report";
import { AgentDrawPicker } from "./AgentDrawPicker";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeZone: "Asia/Bangkok" });
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const FILTERS: Array<{ value: SimpleAgentBillFilter; label: string; count: "all" | "won" | "pending" | "lost" }> = [
  { value: "ALL", label: "ทุกบิล", count: "all" },
  { value: "WON", label: "ถูกรางวัล", count: "won" },
  { value: "PENDING", label: "รอผล", count: "pending" },
  { value: "LOST", label: "ไม่ถูกรางวัล", count: "lost" },
];

export async function AgentReports({ actor, selectedDrawId, billStatus = "ALL", page = 1 }: {
  actor: Actor; selectedDrawId?: string; billStatus?: SimpleAgentBillFilter; page?: number;
}) {
  const report = await getSimpleAgentReport(actor, selectedDrawId, billStatus, page);
  const round = report.rounds[0];
  const history = report.billHistory;
  const customSelection = Boolean(selectedDrawId && selectedDrawId === report.selectedDrawId);
  const href = (status: SimpleAgentBillFilter, targetPage = 1) => {
    const params = new URLSearchParams();
    if (customSelection) params.set("draw", report.selectedDrawId);
    if (status !== "ALL") params.set("result", status);
    if (targetPage > 1) params.set("page", String(targetPage));
    return `/reports${params.size ? `?${params}` : ""}`;
  };

  return <main className="agent-reports-page agent-simple-report">
    <header className="agent-simple-hero">
      <div><p className="page-eyebrow">รายงาน Agent</p><h1>บิลและผลรางวัลของฉัน</h1><p>เลือกงวด แล้วดูว่าบิลไหนถูกรางวัล รอผล หรือไม่ถูกรางวัล</p></div>
      <div className="agent-simple-identity"><span>Agent</span><strong>{report.agent.code}</strong><small>{report.agent.name}</small></div>
    </header>
    <AgentDrawPicker options={report.drawOptions.map((draw) => ({ id: draw.id, name: draw.name }))} value={customSelection ? report.selectedDrawId : ""} latestName={report.drawOptions[0]?.name ?? ""} />
    {round ? <>
      <section className="agent-bill-overview" aria-label="ภาพรวมบิลในงวด">
        <div className="agent-bill-overview-heading"><span>งวดที่กำลังดู</span><h2>{round.drawName}</h2><p>ปิดรับ {DATE.format(round.cutoffAt)} · แสดงเฉพาะบิลที่ยืนยันแล้ว</p></div>
        <div><span>บิลทั้งหมด</span><strong>{history.counts.all.toLocaleString("th-TH")}</strong><small>บิล</small></div>
        <div className="is-won"><span>ถูกรางวัล</span><strong>{history.counts.won.toLocaleString("th-TH")}</strong><small>บิล</small></div>
        <div><span>รอผล</span><strong>{history.counts.pending.toLocaleString("th-TH")}</strong><small>บิล</small></div>
        <div><span>ค่าคอมของฉัน</span><strong>{MONEY.format(Number(round.commission))}</strong><small>บาท · {round.commissionFinal ? "คำนวณแล้ว" : "ประมาณการ"}</small></div>
      </section>
      <section className="agent-bill-history" aria-labelledby="agent-bill-history-heading">
        <header><div><h2 id="agent-bill-history-heading">รายการบิลในงวดนี้</h2><p>เลือกสถานะ แล้วกด “ดูบิล” เพื่อดูเลขและรายการแทง</p></div><Link href={`/bills?draw=${encodeURIComponent(round.drawId)}&scope=all&all=1`}>ไปหน้ารายการบิลทั้งหมด →</Link></header>
        <nav className="agent-bill-status-tabs" aria-label="กรองผลรางวัลของบิล">{FILTERS.map((filter) => <Link key={filter.value} href={href(filter.value)} className={history.status === filter.value ? "is-active" : ""} aria-current={history.status === filter.value ? "page" : undefined}>{filter.label} <b>{history.counts[filter.count].toLocaleString("th-TH")}</b></Link>)}</nav>
        {history.rows.length === 0 ? <div className="agent-simple-empty"><strong>ไม่มีบิลในสถานะนี้</strong><p>ลองเลือกสถานะอื่นหรืองวดอื่น</p></div> : <div className="agent-bill-list">{history.rows.map((bill) => {
          const status = betStatusOf(bill);
          const label = status === "WON" ? "ถูกรางวัล" : status === "LOST" ? "ไม่ถูกรางวัล" : "รอผล";
          return <article key={bill.id} className={`agent-bill-row is-${status.toLowerCase()}`}>
            <div className="agent-bill-main"><small>บิล {visibleBillNumber(bill.drawSequence)} · {DATE_TIME.format(bill.createdAt)}</small><strong>{bill.title || "ไม่ระบุชื่อลูกค้า"}</strong></div>
            <span className="agent-bill-result">{label}</span>
            <div className="agent-bill-money"><span>ยอดเดิมพัน <b>{MONEY.format(Number(bill.totalStake))} บาท</b></span>{status === "WON" && <span>เงินรางวัล <b>{MONEY.format(Number(bill.totalPayout))} บาท</b></span>}</div>
            <Link className="agent-simple-detail" href={`/bills/${bill.id}`}>ดูบิล →</Link>
          </article>;
        })}</div>}
        {history.pages > 1 && <nav className="agent-bill-pagination" aria-label="หน้ารายการบิล">{history.page > 1 ? <Link href={href(history.status, history.page - 1)}>← ก่อนหน้า</Link> : <span />}<span>หน้า {history.page.toLocaleString("th-TH")} / {history.pages.toLocaleString("th-TH")}</span>{history.page < history.pages ? <Link href={href(history.status, history.page + 1)}>ถัดไป →</Link> : <span />}</nav>}
      </section>
    </> : <section className="agent-simple-empty agent-simple-no-draw"><strong>ยังไม่มีงวดสำหรับแสดงรายงาน</strong><p>เมื่อมีงวดและบิลที่ยืนยันแล้ว ข้อมูลจะปรากฏที่นี่</p></section>}
  </main>;
}

import Link from "next/link";
import "./reports.css";
import type { Actor } from "@/lib/auth/context";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { betStatusOf } from "@/lib/bills/betting";
import { getSimpleAgentReport, type SimpleAgentBillFilter } from "@/lib/reports/agent-report";
import { DashboardFilters } from "../DashboardFilters";
import { dashboardDrawLabel } from "@/lib/dashboard/lottery-draw-filter";
import { reportCategoryLabel, reportCategoryOf } from "@/lib/reports/draw-groups";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const FILTERS: Array<{ value: SimpleAgentBillFilter; label: string; count: "all" | "won" | "pending" | "lost" }> = [
  { value: "ALL", label: "ทุกบิล", count: "all" },
  { value: "WON", label: "ถูกรางวัล", count: "won" },
  { value: "PENDING", label: "รอผล", count: "pending" },
  { value: "LOST", label: "ไม่ถูกรางวัล", count: "lost" },
];

export async function AgentReports({ actor, selectedDrawId, billStatus = "ALL", page = 1, lottery, dateFrom, dateTo }: {
  actor: Actor; selectedDrawId?: string; billStatus?: SimpleAgentBillFilter; page?: number; lottery?: string; dateFrom?: string; dateTo?: string;
}) {
  const report = await getSimpleAgentReport(actor, selectedDrawId, billStatus, page, { lottery, dateFrom, dateTo });
  const history = report.billHistory;
  const selectedDraw = report.drawScope.selectedDraw;
  const scopeLabel = selectedDraw
    ? `${reportCategoryLabel(selectedDraw.category)} · ${dashboardDrawLabel(selectedDraw)}`
    : report.drawScope.category === "ALL" ? "รวมทุกงวด · ทุกประเภท" : `รวมทุกงวด · ${reportCategoryLabel(report.drawScope.category)}`;
  const href = (status: SimpleAgentBillFilter, targetPage = 1) => {
    const params = new URLSearchParams();
    if (selectedDraw) params.set("drawId", selectedDraw.id);
    if (report.drawScope.category !== "ALL") params.set("lottery", report.drawScope.category);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (status !== "ALL") params.set("result", status);
    if (targetPage > 1) params.set("page", String(targetPage));
    return `/reports${params.size ? `?${params}` : ""}`;
  };

  return <main className="agent-reports-page agent-simple-report">
    <header className="agent-simple-hero">
      <div><p className="page-eyebrow">รายงาน Agent</p><h1>ยอดขาย รางวัล และบิลของฉัน</h1><p>เลือกประเภทหวย งวด หรือช่วงวันที่ เพื่อดูยอดรวมและบิลที่ถูกรางวัล</p></div>
      <div className="agent-simple-identity"><span>Agent</span><strong>{report.agent.code}</strong><small>{report.agent.name}</small></div>
    </header>
    <DashboardFilters
      draws={report.drawScope.logicalDraws.map((draw) => ({ id: draw.id, label: `${reportCategoryLabel(draw.category)} · ${dashboardDrawLabel(draw)}`, lotteryType: draw.lotteryType, category: draw.category, status: draw.status }))}
      category={report.drawScope.category}
      selectedDrawId={selectedDraw?.id}
    />
    {report.drawOptions.length > 0 ? <>
      <section className="agent-bill-overview" aria-label="ยอดรวมตามตัวกรอง">
        <div className="agent-bill-overview-heading"><span>ข้อมูลที่กำลังดู</span><h2>{scopeLabel}</h2><p>{report.rounds.length.toLocaleString("th-TH")} งวด · เฉพาะบิลที่ยืนยันแล้ว</p></div>
        <div><span>ยอดขาย</span><strong>{MONEY.format(Number(report.totals.gross))}</strong><small>บาท</small></div>
        <div><span>จ่ายรางวัล</span><strong>{MONEY.format(Number(report.totals.payout))}</strong><small>บาท · งวดที่ออกผลแล้ว</small></div>
        <div><span>ค่าคอมของฉัน</span><strong>{MONEY.format(Number(report.totals.commission))}</strong><small>บาท · {report.totals.commissionFinal ? "คำนวณแล้ว" : "รวมยอดประมาณการของงวดที่รอผล"}</small></div>
      </section>
      <section className="agent-bill-history" aria-labelledby="agent-bill-history-heading">
        <header><div><h2 id="agent-bill-history-heading">รายการบิลตามตัวกรอง</h2><p>เลือกสถานะ แล้วกด “ดูบิล” เพื่อดูเลขและรายการแทง</p></div><Link href={selectedDraw ? `/bills?draw=${encodeURIComponent(selectedDraw.id)}&scope=all&all=1` : "/bills?scope=all&all=1"}>ไปหน้ารายการบิลทั้งหมด →</Link></header>
        <nav className="agent-bill-status-tabs" aria-label="กรองผลรางวัลของบิล">{FILTERS.map((filter) => <Link key={filter.value} href={href(filter.value)} className={history.status === filter.value ? "is-active" : ""} aria-current={history.status === filter.value ? "page" : undefined}>{filter.label} <b>{history.counts[filter.count].toLocaleString("th-TH")}</b></Link>)}</nav>
        {history.rows.length === 0 ? <div className="agent-simple-empty"><strong>ไม่มีบิลตามตัวกรองนี้</strong><p>ลองเลือกสถานะ ประเภทหวย งวด หรือวันที่อื่น</p></div> : <div className="agent-bill-list">{history.rows.map((bill) => {
          const status = betStatusOf(bill);
          const label = status === "WON" ? "ถูกรางวัล" : status === "LOST" ? "ไม่ถูกรางวัล" : "รอผล";
          return <article key={bill.id} className={`agent-bill-row is-${status.toLowerCase()}`}>
            <div className="agent-bill-main"><small>บิล {visibleBillNumber(bill.drawSequence)} · {DATE_TIME.format(bill.createdAt)}</small><strong>{bill.title || "ไม่ระบุชื่อลูกค้า"}</strong><small>{reportCategoryLabel(reportCategoryOf(bill.draw.lotteryType))} · {dashboardDrawLabel(bill.draw)}</small></div>
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

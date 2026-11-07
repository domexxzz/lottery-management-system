import Link from "next/link";
import type { Actor } from "@/lib/auth/context";
import { customerProfileKey } from "@/lib/customers/profile-key";
import { getAgentReport, type AgentReportFilter, type AgentReportView } from "@/lib/reports/agent-report";
import { AgentReportActions, AgentReportControls } from "./AgentReportControls";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });
const DATETIME = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const BILL_STATUS: Record<string, string> = { CONFIRMED: "ยืนยันแล้ว", LOCKED: "ล็อกแล้ว", SETTLED: "คำนวณแล้ว" };

const TABS: { value: AgentReportView; label: string }[] = [
  { value: "summary", label: "สรุปรายงวด" },
  { value: "prizes", label: "ตามประเภทรางวัล" },
  { value: "bills", label: "รายละเอียดบิล" },
  { value: "settlements", label: "Settlement" },
];

function settlementBadge(status: string) {
  if (status === "PENDING") return <span className="report-status pending">รอ Settlement</span>;
  if (status === "DRAFT") return <span className="report-status calculated">คำนวณแล้ว</span>;
  if (status === "RECONCILED") return <span className="report-status reconciled">ตรวจสอบยอดแล้ว</span>;
  return <span className="report-status approved">อนุมัติแล้ว</span>;
}

function difference(current: number, previous: number) {
  if (previous === 0) return null;
  return (current - previous) / previous * 100;
}

export async function AgentReports({ actor, filters }: { actor: Actor; filters: AgentReportFilter }) {
  const report = await getAgentReport(actor, filters);
  const query = new URLSearchParams();
  if (report.selectedDrawId) query.set("draw", report.selectedDrawId);
  if (report.dateFrom) query.set("dateFrom", report.dateFrom);
  if (report.dateTo) query.set("dateTo", report.dateTo);
  if (report.selectedSettlement !== "ALL") query.set("settlement", report.selectedSettlement);
  const tabHref = (view: AgentReportView) => { const next = new URLSearchParams(query); if (view !== "summary") next.set("view", view); return `/reports${next.size ? `?${next}` : ""}`; };
  const selectedDraw = report.draws.find((draw) => draw.id === report.selectedDrawId);
  const scopeLabel = selectedDraw?.name ?? (report.dateFrom || report.dateTo ? `${report.dateFrom || "เริ่มต้น"} ถึง ${report.dateTo || "ปัจจุบัน"}` : "ทุกงวด");
  const generatedAt = DATETIME.format(new Date());
  const comparison = report.previousTotals ? [
    { label: "ยอดขาย", current: Number(report.totals.gross), previous: Number(report.previousTotals.gross) },
    { label: "จ่ายรางวัล", current: Number(report.totals.payout), previous: Number(report.previousTotals.payout) },
    { label: "คอมมิชชัน", current: Number(report.totals.commission), previous: Number(report.previousTotals.commission) },
  ] : [];
  const comparisonMax = Math.max(...comparison.flatMap((item) => [item.current, item.previous]), 1);

  return <main className="agent-reports-page">
    <header className="agent-report-header">
      <div><p className="page-eyebrow">Agent Report Center</p><h1>ศูนย์รายงานของฉัน</h1><p>ตรวจสอบข้อมูลย้อนหลัง เปรียบเทียบผล และดาวน์โหลดรายงาน</p></div>
      <AgentReportActions />
    </header>

    <AgentReportControls draws={report.draws} agentLabel={`${report.agent.code} · ${report.agent.name}`} />

    <nav className="agent-report-tabs" aria-label="ประเภทรายงาน">{TABS.map((tab) => <Link key={tab.value} href={tabHref(tab.value)} className={report.selectedView === tab.value ? "active" : undefined}>{tab.label}</Link>)}</nav>

    <section className="agent-report-sheet">
      <div className="agent-report-sheet-heading">
        <div><h2>{TABS.find((tab) => tab.value === report.selectedView)?.label}</h2><p>ช่วงข้อมูล: {scopeLabel} <i /> ออกรายงาน {generatedAt} น.</p></div>
        <div className="report-legend"><span>{settlementBadge("DRAFT")} คำนวณแล้ว</span><span>{settlementBadge("PENDING")} ยังไม่มียอดสุทธิ</span></div>
      </div>

      <dl className="agent-report-summary">
        <div><dt>ยอดขายรวม</dt><dd>{MONEY.format(Number(report.totals.gross))}</dd></div>
        <div><dt>บิล</dt><dd>{report.totals.billCount}</dd></div>
        <div><dt>รายการ</dt><dd>{report.totals.itemCount}</dd></div>
        <div><dt>จ่ายรางวัล</dt><dd>{MONEY.format(Number(report.totals.payout))}</dd></div>
        <div><dt>คอมมิชชันจริง</dt><dd>{MONEY.format(Number(report.totals.commission))}</dd></div>
        <div><dt>สุทธิ</dt><dd className={report.totals.net.isNegative() ? "negative" : undefined}>{MONEY.format(Number(report.totals.net))}</dd></div>
      </dl>

      {report.selectedView === "summary" && <>
        <div className="report-section-title"><div><p className="page-eyebrow">Round Performance</p><h3>ผลการดำเนินงานรายงวด</h3></div><span>{report.rows.length} งวด</span></div>
        {report.rows.length === 0 ? <p className="agent-report-empty">ไม่พบข้อมูลตามตัวกรอง</p> : <div className="table-wrap"><table className="agent-round-table"><thead><tr><th>งวด</th><th>วันที่ปิดรับ</th><th className="num">บิล</th><th className="num">รายการ</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th className="num">คอมมิชชัน</th><th className="num">สุทธิ</th><th>สถานะ</th><th>รายละเอียด</th></tr></thead><tbody>{report.rows.map((row) => <tr key={row.drawId}><td><strong>{row.drawName}</strong></td><td>{DATE.format(row.cutoffAt)}</td><td className="num">{row.billCount}</td><td className="num">{row.itemCount}</td><td className="num">{MONEY.format(Number(row.gross))}</td><td className="num payout">{MONEY.format(Number(row.payout))}</td><td className="num">{row.commission === null ? "—" : MONEY.format(Number(row.commission))}</td><td className={`num ${row.net?.isNegative() ? "negative" : ""}`}>{row.net === null ? "—" : MONEY.format(Number(row.net))}</td><td>{settlementBadge(row.settlementStatus)}</td><td><Link href={`/reports?draw=${row.drawId}`}>ดูรายละเอียด →</Link></td></tr>)}</tbody><tfoot><tr><th>รวมทั้งหมด</th><th /><th className="num">{report.totals.billCount}</th><th className="num">{report.totals.itemCount}</th><th className="num">{MONEY.format(Number(report.totals.gross))}</th><th className="num payout">{MONEY.format(Number(report.totals.payout))}</th><th className="num">{MONEY.format(Number(report.totals.commission))}</th><th className={`num ${report.totals.net.isNegative() ? "negative" : ""}`}>{MONEY.format(Number(report.totals.net))}</th><th /><th /></tr></tfoot></table></div>}

        <div className="agent-report-bottom">
          <article className="report-comparison">
            <div className="report-section-title"><div><p className="page-eyebrow">Period Comparison</p><h3>เปรียบเทียบกับช่วงก่อนหน้า</h3></div></div>
            {comparison.length === 0 ? <p className="agent-report-empty compact">เลือกวันที่เริ่มต้นและวันที่สิ้นสุดเพื่อเปรียบเทียบช่วงก่อนหน้า</p> : <div className="comparison-list">{comparison.map((item) => {
              const change = difference(item.current, item.previous);
              return <div key={item.label}><strong>{item.label}</strong><span className="comparison-bars"><i style={{ width: `${item.current / comparisonMax * 100}%` }} /><u style={{ width: `${item.previous / comparisonMax * 100}%` }} /></span><span className="comparison-values"><b>{MONEY.format(item.current)}</b><small>{MONEY.format(item.previous)}</small></span><em className={change !== null && change < 0 ? "down" : undefined}>{change === null ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`}</em></div>;
            })}</div>}
          </article>
          <aside className="agent-report-note"><h3>ⓘ หมายเหตุรายงาน</h3><p>ตัวเลขคอมมิชชันและสุทธิแสดงเฉพาะงวดที่คำนวณ Settlement แล้ว</p><dl><div><dt>คำนวณแล้ว</dt><dd>{report.totals.settledCount} งวด</dd></div><div><dt>รอ Settlement</dt><dd>{report.totals.pendingCount} งวด</dd></div></dl></aside>
        </div>
      </>}

      {report.selectedView === "prizes" && <><div className="report-section-title"><div><p className="page-eyebrow">Prize Breakdown</p><h3>รายงานตามประเภทรางวัล</h3></div><span>{report.prizes.length} ประเภท</span></div>{report.prizes.length === 0 ? <p className="agent-report-empty">ไม่พบข้อมูลตามตัวกรอง</p> : <div className="table-wrap"><table><thead><tr><th>รหัส</th><th>ประเภทรางวัล</th><th className="num">รายการ</th><th className="num">ถูกรางวัล</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th className="num">อัตราจ่าย</th></tr></thead><tbody>{report.prizes.map((row) => { const gross = Number(row.gross); const ratio = gross > 0 ? Number(row.payout) / gross * 100 : 0; return <tr key={row.code}><td>{row.code}</td><td><strong>{row.name}</strong></td><td className="num">{row.count}</td><td className="num">{row.winners}</td><td className="num">{MONEY.format(gross)}</td><td className="num payout">{MONEY.format(Number(row.payout))}</td><td className="num">{ratio.toFixed(1)}%</td></tr>})}</tbody></table></div>}</>}

      {report.selectedView === "bills" && <><div className="report-section-title"><div><p className="page-eyebrow">Bill Detail</p><h3>รายละเอียดบิล</h3></div><span>สูงสุด 200 บิล</span></div>{report.bills.length === 0 ? <p className="agent-report-empty">ไม่พบข้อมูลตามตัวกรอง</p> : <div className="table-wrap"><table><thead><tr><th>เลขบิล</th><th>ชื่อบิล</th><th>งวด</th><th className="num">รายการ</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th>วันที่สร้าง</th><th>สถานะ</th></tr></thead><tbody>{report.bills.map((bill) => <tr key={bill.id}><td><Link href={`/bills/${bill.id}`}>{bill.billNumber ?? "—"}</Link></td><td><Link href={`/customers/${customerProfileKey(bill.title)}`}>{bill.title}</Link></td><td>{bill.draw.name}</td><td className="num">{bill._count.items}</td><td className="num">{MONEY.format(Number(bill.totalStake))}</td><td className="num payout">{MONEY.format(Number(bill.totalPayout))}</td><td>{DATETIME.format(bill.createdAt)}</td><td><span className="report-status neutral">{BILL_STATUS[bill.status] ?? bill.status}</span></td></tr>)}</tbody></table></div>}</>}

      {report.selectedView === "settlements" && <><div className="report-section-title"><div><p className="page-eyebrow">Settlement Detail</p><h3>ประวัติ Settlement</h3></div><span>{report.settlements.length} รายการ</span></div>{report.settlements.length === 0 ? <p className="agent-report-empty">ยังไม่มี Settlement ตามตัวกรอง</p> : <div className="table-wrap"><table><thead><tr><th>งวด</th><th>วันที่ปิดรับ</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th className="num">คอมมิชชัน</th><th className="num">สุทธิ</th><th>สถานะ</th></tr></thead><tbody>{report.settlements.map((row) => <tr key={row.drawId}><td><strong>{row.drawName}</strong></td><td>{DATE.format(row.cutoffAt)}</td><td className="num">{MONEY.format(Number(row.gross))}</td><td className="num payout">{MONEY.format(Number(row.payout))}</td><td className="num">{MONEY.format(Number(row.commission))}</td><td className={`num ${row.net?.isNegative() ? "negative" : ""}`}>{MONEY.format(Number(row.net))}</td><td>{settlementBadge(row.settlementStatus)}</td></tr>)}</tbody></table></div>}</>}
    </section>
  </main>;
}

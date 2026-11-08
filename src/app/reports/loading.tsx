import "./reports.css";

export default function ReportsLoading() {
  return <main className="workspace-page reports-page reports-page--blue"><section className="card workspace-card report-workspace report-workspace--blue report-loading" role="status" aria-label="กำลังโหลดรายงาน"><div className="report-loading-line report-loading-line--title" /><div className="report-loading-cards"><div /><div /><div /></div><div className="report-loading-chart" /><p>กำลังโหลดข้อมูลรายงาน…</p></section></main>;
}

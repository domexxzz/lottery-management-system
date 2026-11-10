import Link from "next/link";
import { visibleBillNumber } from "@/lib/bills/numbering";
import type { Actor } from "@/lib/auth/context";
import { loadManagementDashboard, type DashboardFilter } from "@/lib/dashboard/management";
import { statusLabel } from "@/lib/bills/lifecycle";
import { DashboardIcon as Icon } from "./DashboardIcon";
import { DashboardFilters } from "./DashboardFilters";
import { OwnerBusinessCharts } from "./OwnerBusinessCharts";
import { DashboardHeading } from "./DashboardHeading";

const STEPS = [
  { key: "OPEN", label: "เปิดรับ", detail: "กำลังรับบิล" },
  { key: "LOCKED", label: "ปิดรับ", detail: "เตรียมลงผล" },
  { key: "RESULT_PENDING", label: "ตรวจผล", detail: "รอผลครบ" },
  { key: "SETTLED", label: "รอปิดบัญชี", detail: "คำนวณ Settlement แล้ว" },
  { key: "CLOSED", label: "ปิดงวด", detail: "เสร็จสมบูรณ์" },
] as const;
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
function dashboardLink(path: string, values: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return params.size > 0 ? `${path}?${params.toString()}` : path;
}

export async function ManagementDashboard({ actor, filters }: { actor: Actor; filters: DashboardFilter }) {
  // รวมยอดทั้งหมดในฐานข้อมูล ดู src/lib/dashboard/management.ts
  const { selectedStatus, currentDraw, drawOptions, summary, recentBills, salesTrend, rankedAgents, drawFinance, agentFinance, awaitingClose, pendingCancellations, anomalyCount, activeAgents } = await loadManagementDashboard(actor, filters);
  const currentStep = currentDraw === null ? -1 : STEPS.findIndex((step) => step.key === currentDraw.status);
  const kpis = [
    { label: "ยอดขาย", value: summary.gross, tone: "blue", icon: "bill" as const },
    { label: "จ่ายรางวัล", value: summary.payout, tone: "amber", icon: "draw" as const },
    { label: "คอมมิชชัน", value: summary.commission, tone: "violet", icon: "agent" as const },
    { label: "สุทธิ", value: summary.net, tone: summary.net < 0 ? "red" : "green", icon: "report" as const },
  ];
  const tasks = [
    { label: "รอปิดบัญชี", detail: "งวดที่คำนวณ Settlement แล้วและพร้อมปิดบัญชี", count: awaitingClose, href: "/draws" },
    { label: "คำขอแก้ไข", detail: "คำขอแก้ไขหรือยกเลิกบิลที่รอพิจารณา", count: pendingCancellations, href: "/bills" },
    { label: "ความผิดปกติ", detail: "รายการที่มียอดสุทธิติดลบและควรตรวจสอบ", count: anomalyCount, href: "/reports" },
  ];
  const maxTrend = Math.max(...salesTrend.map((point) => point.value), 1);
  const chartPoints = salesTrend.map((point, index) => ({ ...point, x: 24 + index * 108.5, y: 166 - (point.value / maxTrend) * 126 }));
  const linePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = `M ${chartPoints[0]?.x ?? 24} 166 L ${chartPoints.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${chartPoints.at(-1)?.x ?? 675} 166 Z`;
  const maxAgentGross = Math.max(...rankedAgents.map((agent) => Number(agent.gross)), 1);
  const volumeTrend = salesTrend.map((row) => ({ label: row.label, bills: row.bills, average: row.bills > 0 ? row.value / row.bills : 0 }));
  const billListHref = dashboardLink("/bills", { draw: filters.drawId, agent: filters.agentId, status: selectedStatus });
  const inspectionHref = dashboardLink("/audit", { draw: filters.drawId, agent: filters.agentId });
  const winnerListHref = dashboardLink("/bills", { draw: filters.drawId, agent: filters.agentId, status: selectedStatus, winner: "1" });

  return <main className="dashboard-body">
    <div className="welcome-row">
      <DashboardHeading icon="brand" eyebrow="ข้อมูลสำหรับผู้บริหาร" title="ภาพรวมทั้งหมด">
        ดูข้อมูลทั้งระบบ หรือเลือกตัวกรองเพื่อเจาะรายละเอียดที่ต้องการ
      </DashboardHeading>
      <div className="welcome-actions">
        {(actor.role === "GODMODE" || actor.role === "OWNER") && <Link href="/analytics" className="analytics-button"><Icon name="analytics"/><strong>วิเคราะห์เชิงลึก</strong><Icon name="arrow"/></Link>}
        <Link href="/audit" className="audit-shortcut"><Icon name="audit"/><strong>ประวัติการตรวจผลรางวัล</strong></Link>
      </div>
    </div>
    <DashboardFilters draws={drawOptions.map((draw) => ({ id: draw.id, label: draw.name }))} />
    <section className="kpi-grid" aria-label="ตัวเลขสรุป">{kpis.map((kpi) => <article key={kpi.label} className={`kpi-card tone-${kpi.tone}`}><span className="kpi-icon"><Icon name={kpi.icon} /></span><div className="kpi-content"><p>{kpi.label}</p><strong>{MONEY.format(Number(kpi.value ?? 0))}</strong><small>บาท · {filters.drawId || filters.agentId || filters.status || filters.dateFrom || filters.dateTo ? "ตามตัวกรอง" : "ข้อมูลทั้งหมด"}</small></div></article>)}</section>
    <OwnerBusinessCharts draws={drawFinance} agents={agentFinance} volume={summary.billCount ? volumeTrend : []} />
    <section className="insight-grid" aria-label="แนวโน้มและสรุปจำนวนข้อมูล">
      <article className="dashboard-panel trend-panel"><div className="panel-heading"><div><p className="eyebrow">แนวโน้มธุรกิจ</p><h2>ยอดขาย 7 วันล่าสุด</h2></div><Link href="/reports">ดูรายงาน <Icon name="arrow" /></Link></div><div className="trend-summary"><strong>{MONEY.format(salesTrend.reduce((sum, point) => sum + point.value, 0))}</strong><span>บาท · ยอดรวม 7 วัน</span></div><div className="line-chart" role="img" aria-label="กราฟเส้นยอดขายย้อนหลัง 7 วัน"><svg viewBox="0 0 700 190" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="salesArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#1697a6" stopOpacity=".3"/><stop offset="100%" stopColor="#1697a6" stopOpacity=".02"/></linearGradient></defs>{[40, 82, 124, 166].map((y) => <line key={y} x1="20" x2="680" y1={y} y2={y} className="chart-gridline" />)}<path d={areaPath} fill="url(#salesArea)"/><polyline points={linePoints} className="sales-line"/>{chartPoints.map((point) => <circle key={point.key} cx={point.x} cy={point.y} r="4.5" />)}</svg><div className="chart-days">{salesTrend.map((point) => <span key={point.key}>{point.label}</span>)}</div></div></article>
      <article className="dashboard-panel count-summary-panel"><div className="panel-heading"><div><p className="eyebrow">ข้อมูลที่เลือก</p><h2>สรุปจำนวน</h2></div></div><div className="count-summary-list"><Link href={billListHref} aria-label={`เปิดรายการบิล ${summary.billCount} บิล`}><span><Icon name="bill" /></span><div><small>จำนวนบิล</small><strong>{summary.billCount}</strong></div><Icon name="arrow" /></Link><Link href={inspectionHref} aria-label={`เปิดประวัติการตรวจผลรางวัล ${summary.itemCount} รายการ`}><span><Icon name="draw" /></span><div><small>จำนวนรายการ</small><strong>{summary.itemCount}</strong></div><Icon name="arrow" /></Link><Link href="/agents" aria-label={`เปิดหน้าจัดการ Agent ${activeAgents} ราย`}><span><Icon name="agent" /></span><div><small>จำนวน Agent</small><strong>{activeAgents}</strong></div><Icon name="arrow" /></Link><Link href={winnerListHref} className="winner-summary" aria-label={`เปิดรายการผู้ถูกรางวัล ${summary.winnerCount} คน`}><span><Icon name="winner" /></span><div><small>ผู้ถูกรางวัล</small><strong>{summary.winnerCount} คน</strong><em>นับลูกค้าไม่ซ้ำ</em></div><Icon name="arrow" /></Link></div></article>
    </section>
    <section className="operations-grid" aria-label="การดำเนินงาน">
      <article className="dashboard-panel agent-performance-panel"><div className="panel-heading"><div><p className="eyebrow">ผลงาน Agent</p><h2>ยอดขายสูงสุดตามข้อมูลที่เลือก</h2></div><Link href="/reports">ดูรายงาน <Icon name="arrow" /></Link></div>{rankedAgents.length === 0 ? <p className="empty-state">ไม่พบยอดขายตามตัวกรองนี้</p> : <div className="agent-ranking">{rankedAgents.map((agent, index) => <div className="agent-rank" key={agent.agentCode}><b>{index + 1}</b><div className="agent-rank-name"><strong>{agent.agentCode} {agent.agentName}</strong><span><i style={{ width: `${(Number(agent.gross) / maxAgentGross) * 100}%` }}/></span></div><div className="agent-rank-value"><strong>{MONEY.format(Number(agent.gross))}</strong><small>{agent.billCount} บิล</small></div></div>)}</div>}</article>
      <section className="dashboard-panel task-panel"><div className="panel-heading"><div><p className="eyebrow">Today&apos;s Priorities</p><h2>งานที่ต้องทำวันนี้</h2></div></div><div className="task-list">{tasks.map((task) => <Link key={task.label} href={task.href}><span className={task.count > 0 ? "task-alert" : "task-ok"}><Icon name={task.count > 0 ? "alert" : "home"}/></span><div><strong>{task.label}</strong><small>{task.count > 0 ? task.detail : "ไม่มีรายการค้าง"}</small></div><b>{task.count}</b><Icon name="arrow"/></Link>)}</div></section>
      <section className="dashboard-panel timeline-panel"><div className="panel-heading"><div><p className="eyebrow">ขั้นตอนการทำงาน</p><h2>สถานะงวด</h2></div></div>{currentDraw === null ? <p className="empty-state">ยังไม่มีงวดในระบบ</p> : <><div className="draw-meta"><strong>{currentDraw.name}</strong><span>ปิดรับ {DATE_TIME.format(currentDraw.cutoffAt)}</span></div><ol className="draw-timeline">{STEPS.map((step, index) => <li key={step.key} className={index < currentStep ? "complete" : index === currentStep ? "current" : ""}><span>{index < currentStep ? "✓" : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol></>}</section>
    </section>
    <section className="dashboard-panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">อัปเดตล่าสุด</p><h2>บิลล่าสุด</h2></div><Link href="/bills">ดูทั้งหมด <Icon name="arrow" /></Link></div>{recentBills.length === 0 ? <p className="empty-state">ยังไม่มีบิลในระบบ</p> : <div className="recent-table-wrap"><table className="recent-table"><thead><tr><th>เลขบิล</th><th>Agent</th><th>วันที่และเวลา</th><th className="num">ยอดขาย</th><th>สถานะ</th></tr></thead><tbody>{recentBills.map((bill) => <tr key={bill.id}><td><Link href={`/bills/${bill.id}`}><strong>{visibleBillNumber(bill.drawSequence)}</strong><small>{bill.title}</small></Link></td><td>{bill.agent.code}<small>{bill.agent.name}</small></td><td>{DATE_TIME.format(bill.createdAt)}</td><td className="num">{MONEY.format(Number(bill.totalStake))}</td><td><span className={`status-chip status-${bill.status.toLowerCase()}`}>{statusLabel(bill.status)}</span></td></tr>)}</tbody></table></div>}</section>
  </main>;
}

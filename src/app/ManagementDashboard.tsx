import Link from "next/link";
import type { BillStatus, Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";
import { orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { statusLabel } from "@/lib/bills/lifecycle";
import { DashboardIcon as Icon } from "./DashboardIcon";
import { DashboardFilters } from "./DashboardFilters";

const DRAW_LABEL: Record<string, string> = { OPEN: "เปิดรับบิล", LOCKED: "ปิดรับแล้ว", RESULT_PENDING: "รอผลและการอนุมัติ", SETTLED: "คำนวณแล้ว", CLOSED: "ปิดบัญชีแล้ว" };
const STEPS = [
  { key: "OPEN", label: "เปิดรับ", detail: "กำลังรับบิล" },
  { key: "LOCKED", label: "ปิดรับ", detail: "เตรียมลงผล" },
  { key: "RESULT_PENDING", label: "ตรวจผล", detail: "รอผลครบ" },
  { key: "SETTLED", label: "กระทบยอด", detail: "ตรวจยอด Agent" },
  { key: "CLOSED", label: "ปิดรอบ", detail: "เสร็จสมบูรณ์" },
] as const;
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const TREND_DAY = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });

type DashboardFilter = { drawId?: string; agentId?: string; status?: string; dateFrom?: string; dateTo?: string };
const BILL_STATUSES: BillStatus[] = ["DRAFT", "CONFIRMED", "LOCKED", "SETTLED", "CANCELLED"];

export async function ManagementDashboard({ actor, filters }: { actor: Actor; filters: DashboardFilter }) {
  const scope = orgScope(actor);
  const currentDraw = (await prisma.draw.findFirst({ where: { ...scope, status: { in: ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED"] } }, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, opensAt: true, cutoffAt: true } })) ?? (await prisma.draw.findFirst({ where: scope, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, opensAt: true, cutoffAt: true } }));
  const parsedFrom = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00+07:00`) : undefined;
  const parsedTo = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999+07:00`) : undefined;
  const validFrom = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : undefined;
  const validTo = parsedTo && !Number.isNaN(parsedTo.getTime()) ? parsedTo : undefined;
  const selectedStatus = BILL_STATUSES.includes(filters.status as BillStatus) ? filters.status as BillStatus : undefined;
  const billWhere: Prisma.BillWhereInput = {
    ...scope,
    ...(filters.drawId ? { drawId: filters.drawId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(selectedStatus ? { status: selectedStatus } : {}),
    ...(validFrom || validTo ? { createdAt: { ...(validFrom ? { gte: validFrom } : {}), ...(validTo ? { lte: validTo } : {}) } } : {}),
  };
  const [filteredBills, drawOptions, agentOptions, pendingResults, pendingSettlements, pendingCancellations, activeAgents] = await Promise.all([
    prisma.bill.findMany({ where: billWhere, orderBy: { createdAt: "desc" }, select: { id: true, billNumber: true, title: true, status: true, totalStake: true, totalPayout: true, createdAt: true, agent: { select: { id: true, code: true, name: true, commissionRate: true } }, _count: { select: { items: true } } } }),
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true } }),
    prisma.agent.findMany({ where: scope, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    currentDraw === null ? Promise.resolve(0) : prisma.result.count({ where: { ...scope, drawId: currentDraw.id, status: "DRAFT" } }),
    currentDraw === null ? Promise.resolve(0) : prisma.settlement.count({ where: { ...scope, drawId: currentDraw.id, status: "DRAFT" } }),
    prisma.bill.count({ where: { ...scope, cancelRequestedAt: { not: null }, cancelledAt: null } }),
    prisma.agent.count({ where: { ...scope, status: "ACTIVE" } }),
  ]);
  const recentBills = filteredBills.slice(0, 5);
  const gross = filteredBills.reduce((sum, bill) => sum + Number(bill.totalStake), 0);
  const payout = filteredBills.reduce((sum, bill) => sum + Number(bill.totalPayout), 0);
  const commission = filteredBills.reduce((sum, bill) => sum + Number(bill.totalStake) * Number(bill.agent.commissionRate) / 100, 0);
  const summary = { gross, payout, commission, net: gross - payout - commission, billCount: filteredBills.length, itemCount: filteredBills.reduce((sum, bill) => sum + bill._count.items, 0) };
  const currentStep = currentDraw === null ? -1 : STEPS.findIndex((step) => step.key === currentDraw.status);
  const kpis = [
    { label: "ยอดขาย", value: summary.gross, tone: "blue", icon: "bill" as const },
    { label: "จ่ายรางวัล", value: summary.payout, tone: "amber", icon: "draw" as const },
    { label: "คอมมิชชัน", value: summary.commission, tone: "violet", icon: "agent" as const },
    { label: "สุทธิ", value: summary.net, tone: summary.net < 0 ? "red" : "green", icon: "report" as const },
  ];
  const tasks = [
    { label: "ผลรางวัลรอตรวจ", count: pendingResults, href: currentDraw ? `/draws/${currentDraw.id}` : "/draws" },
    { label: "รายการรอกระทบยอด", count: pendingSettlements, href: currentDraw ? `/draws/${currentDraw.id}` : "/draws" },
    { label: "คำขอยกเลิกบิล", count: pendingCancellations, href: "/bills" },
  ];
  const salesByDay = new Map<string, number>();
  for (const bill of filteredBills) { const key = TREND_DAY.format(bill.createdAt); salesByDay.set(key, (salesByDay.get(key) ?? 0) + Number(bill.totalStake)); }
  const chartEnd = validTo ?? filteredBills[0]?.createdAt ?? new Date();
  const salesTrend = Array.from({ length: 7 }, (_, index) => { const date = new Date(chartEnd.getTime() - (6 - index) * 86400000); const label = TREND_DAY.format(date); return { label, value: salesByDay.get(label) ?? 0 }; });
  const maxTrend = Math.max(...salesTrend.map((point) => point.value), 1);
  const chartPoints = salesTrend.map((point, index) => ({ ...point, x: 24 + index * 108.5, y: 166 - (point.value / maxTrend) * 126 }));
  const linePoints = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPath = `M ${chartPoints[0]?.x ?? 24} 166 L ${chartPoints.map((point) => `${point.x} ${point.y}`).join(" L ")} L ${chartPoints.at(-1)?.x ?? 675} 166 Z`;
  const agentTotals = new Map<string, { agentCode: string; agentName: string; gross: number; billCount: number }>();
  for (const bill of filteredBills) { const row = agentTotals.get(bill.agent.id) ?? { agentCode: bill.agent.code, agentName: bill.agent.name, gross: 0, billCount: 0 }; row.gross += Number(bill.totalStake); row.billCount += 1; agentTotals.set(bill.agent.id, row); }
  const rankedAgents = [...agentTotals.values()].sort((a, b) => b.gross - a.gross).slice(0, 5);
  const maxAgentGross = Math.max(...rankedAgents.map((agent) => Number(agent.gross)), 1);
  const payoutRatio = gross > 0 ? (payout / gross) * 100 : 0;
  const cappedPayoutRatio = Math.min(Math.max(payoutRatio, 0), 100);
  const risk = payoutRatio > 100 ? { label: "ความเสี่ยงสูง", className: "risk-high", detail: "ยอดจ่ายสูงกว่ายอดขาย" } : payoutRatio > 70 ? { label: "ควรเฝ้าระวัง", className: "risk-medium", detail: "อัตราจ่ายเริ่มสูง" } : { label: "ความเสี่ยงต่ำ", className: "risk-low", detail: "งวดอยู่ในเกณฑ์ปกติ" };

  return <div className="dashboard-body">
    <div className="welcome-row"><div><p className="eyebrow">ข้อมูลสำหรับผู้บริหาร</p><h1>ภาพรวมทั้งหมด</h1><p>ดูข้อมูลทั้งระบบ หรือเลือกตัวกรองเพื่อเจาะรายละเอียดที่ต้องการ</p></div><div className="welcome-actions"><Link href="/analytics" className="analytics-button"><Icon name="analytics"/><span><small>Customer Intelligence</small><strong>วิเคราะห์เชิงลึก</strong></span><Icon name="arrow"/></Link><Link href="/audit" className="audit-shortcut"><Icon name="audit"/><span><small>แก้ไขไม่ได้</small><strong>ประวัติการตรวจ</strong></span></Link>{currentDraw !== null && <Link href={`/draws/${currentDraw.id}`} className="current-draw"><span>งวดปัจจุบัน</span><strong>{currentDraw.name}</strong><small>{DRAW_LABEL[currentDraw.status]}</small><Icon name="arrow" /></Link>}</div></div>
    <DashboardFilters draws={drawOptions.map((draw) => ({ id: draw.id, label: draw.name }))} agents={agentOptions.map((agent) => ({ id: agent.id, label: `${agent.code} · ${agent.name}` }))} />
    <section className="kpi-grid" aria-label="ตัวเลขสรุป">{kpis.map((kpi) => <article key={kpi.label} className={`kpi-card tone-${kpi.tone}`}><span className="kpi-icon"><Icon name={kpi.icon} /></span><div className="kpi-content"><p>{kpi.label}</p><strong>{MONEY.format(Number(kpi.value ?? 0))}</strong><small>บาท · {filters.drawId || filters.agentId || filters.status || filters.dateFrom || filters.dateTo ? "ตามตัวกรอง" : "ข้อมูลทั้งหมด"}</small></div></article>)}</section>
    <section className="insight-grid" aria-label="แนวโน้มและความเสี่ยง">
      <article className="dashboard-panel trend-panel"><div className="panel-heading"><div><p className="eyebrow">แนวโน้มธุรกิจ</p><h2>ยอดขาย 7 วันล่าสุด</h2></div><Link href="/reports">ดูรายงาน <Icon name="arrow" /></Link></div><div className="trend-summary"><strong>{MONEY.format(salesTrend.reduce((sum, point) => sum + point.value, 0))}</strong><span>บาท · ยอดรวม 7 วัน</span></div><div className="line-chart" role="img" aria-label="กราฟเส้นยอดขายย้อนหลัง 7 วัน"><svg viewBox="0 0 700 190" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="salesArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#1697a6" stopOpacity=".3"/><stop offset="100%" stopColor="#1697a6" stopOpacity=".02"/></linearGradient></defs>{[40, 82, 124, 166].map((y) => <line key={y} x1="20" x2="680" y1={y} y2={y} className="chart-gridline" />)}<path d={areaPath} fill="url(#salesArea)"/><polyline points={linePoints} className="sales-line"/>{chartPoints.map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="4.5"><title>{point.label}: {MONEY.format(point.value)} บาท</title></circle>)}</svg><div className="chart-days">{salesTrend.map((point) => <span key={point.label}>{point.label}</span>)}</div></div></article>
      <article className={`dashboard-panel risk-panel ${risk.className}`}><div className="panel-heading"><div><p className="eyebrow">สุขภาพข้อมูลที่เลือก</p><h2>ระดับความเสี่ยง</h2></div><span className="risk-badge">{risk.label}</span></div><div className="risk-gauge"><svg viewBox="0 0 200 112" aria-hidden="true"><path className="gauge-track" d="M20 100 A80 80 0 0 1 180 100" pathLength="100"/><path className="gauge-value" d="M20 100 A80 80 0 0 1 180 100" pathLength="100" strokeDasharray={`${cappedPayoutRatio} 100`}/></svg><div><strong>{payoutRatio.toFixed(1)}%</strong><span>จ่ายต่อยอดขาย</span></div></div><p className="risk-detail">{risk.detail}</p><div className="risk-stats"><div><strong>{summary.billCount}</strong><span>จำนวนบิล</span></div><div><strong>{summary.itemCount}</strong><span>รายการ</span></div><div><strong>{activeAgents}</strong><span>Agent ใช้งาน</span></div></div></article>
    </section>
    <section className="operations-grid" aria-label="การดำเนินงาน">
      <article className="dashboard-panel agent-performance-panel"><div className="panel-heading"><div><p className="eyebrow">ผลงาน Agent</p><h2>ยอดขายสูงสุดตามข้อมูลที่เลือก</h2></div><Link href="/reports">ดูรายงาน <Icon name="arrow" /></Link></div>{rankedAgents.length === 0 ? <p className="empty-state">ไม่พบยอดขายตามตัวกรองนี้</p> : <div className="agent-ranking">{rankedAgents.map((agent, index) => <div className="agent-rank" key={agent.agentCode}><b>{index + 1}</b><div className="agent-rank-name"><strong>{agent.agentCode} {agent.agentName}</strong><span><i style={{ width: `${(Number(agent.gross) / maxAgentGross) * 100}%` }}/></span></div><div className="agent-rank-value"><strong>{MONEY.format(Number(agent.gross))}</strong><small>{agent.billCount} บิล</small></div></div>)}</div>}</article>
      <section className="dashboard-panel task-panel"><div className="panel-heading"><div><p className="eyebrow">ต้องตรวจสอบ</p><h2>งานที่ต้องดำเนินการ</h2></div></div><div className="task-list">{tasks.map((task) => <Link key={task.label} href={task.href}><span className={task.count > 0 ? "task-alert" : "task-ok"}><Icon name={task.count > 0 ? "alert" : "home"}/></span><div><strong>{task.label}</strong><small>{task.count > 0 ? "รอการดำเนินการ" : "ไม่มีรายการค้าง"}</small></div><b>{task.count}</b><Icon name="arrow"/></Link>)}</div></section>
      <section className="dashboard-panel timeline-panel"><div className="panel-heading"><div><p className="eyebrow">ขั้นตอนการทำงาน</p><h2>สถานะรอบ</h2></div></div>{currentDraw === null ? <p className="empty-state">ยังไม่มีรอบในระบบ</p> : <><div className="draw-meta"><strong>{currentDraw.name}</strong><span>ปิดรับ {DATE_TIME.format(currentDraw.cutoffAt)}</span></div><ol className="draw-timeline">{STEPS.map((step, index) => <li key={step.key} className={index < currentStep ? "complete" : index === currentStep ? "current" : ""}><span>{index < currentStep ? "✓" : index + 1}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div></li>)}</ol></>}</section>
    </section>
    <section className="dashboard-panel recent-panel"><div className="panel-heading"><div><p className="eyebrow">อัปเดตล่าสุด</p><h2>บิลล่าสุด</h2></div><Link href="/bills">ดูทั้งหมด <Icon name="arrow" /></Link></div>{recentBills.length === 0 ? <p className="empty-state">ยังไม่มีบิลในระบบ</p> : <div className="recent-table-wrap"><table className="recent-table"><thead><tr><th>เลขบิล</th><th>Agent</th><th>วันที่และเวลา</th><th className="num">ยอดขาย</th><th>สถานะ</th></tr></thead><tbody>{recentBills.map((bill) => <tr key={bill.id}><td><Link href={`/bills/${bill.id}`}><strong>{bill.billNumber ?? "บิลร่าง"}</strong><small>{bill.title}</small></Link></td><td>{bill.agent.code}<small>{bill.agent.name}</small></td><td>{DATE_TIME.format(bill.createdAt)}</td><td className="num">{MONEY.format(Number(bill.totalStake))}</td><td><span className={`status-chip status-${bill.status.toLowerCase()}`}>{statusLabel(bill.status)}</span></td></tr>)}</tbody></table></div>}</section>
  </div>;
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listAgents } from "@/lib/agents/service";
import { aggregateAgentCustomers } from "@/lib/agents/customer-aggregation";
import { customerProfileKey } from "@/lib/customers/profile-key";
import { prisma } from "@/lib/db";
import { AgentDashboardFilters } from "./AgentDashboardFilters";
import { DashboardIcon } from "../DashboardIcon";
import "./agents.css";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "ใช้งาน",
  SUSPENDED: "ระงับ",
  CLOSED: "ปิด",
};

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/");

  const query = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const drawId = first(query.drawId);
  const selectedAllDraws = !drawId || drawId === "all";
  const status = first(query.status);
  const agentId = first(query.agentId);
  const search = first(query.q)?.trim().toLocaleLowerCase("th-TH") ?? "";
  const requestedPage = Math.max(1, Number.parseInt(first(query.page) ?? "1", 10) || 1);
  const drawOptions = await prisma.draw.findMany({ where: orgScope(actor), orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, cutoffAt: true } });
  const organization = await prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } });
  const defaultDraw = drawOptions.find((draw) => ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED"].includes(draw.status)) ?? drawOptions[0] ?? null;
  const currentDraw = selectedAllDraws
    ? null
    : ((drawId ? drawOptions.find((draw) => draw.id === drawId) : defaultDraw) ?? defaultDraw);
  const [allAgents, countedBills, settlements] = await Promise.all([
    listAgents(actor),
    prisma.bill.findMany({
      where: { ...orgScope(actor), status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } },
      select: { agentId: true, drawId: true, title: true, totalStake: true, totalPayout: true, createdAt: true },
    }),
    prisma.settlement.findMany({
      where: orgScope(actor),
      select: { agentId: true, drawId: true, gross: true, payout: true, commission: true, net: true, status: true },
    }),
  ]);
  const agents = allAgents.filter((agent) => (!agentId || agent.id === agentId) && (!status || agent.status === status) && (!search || `${agent.code} ${agent.name}`.toLocaleLowerCase("th-TH").includes(search)));
  const performance = new Map<string, { allSales: number; allBills: number; allCommission: number; allNet: number; currentSales: number; currentBills: number; currentPayout: number; currentCommission: number; currentNet: number; settlementStatus: string | null }>();
  for (const agent of agents) performance.set(agent.id, { allSales: 0, allBills: 0, allCommission: 0, allNet: 0, currentSales: 0, currentBills: 0, currentPayout: 0, currentCommission: 0, currentNet: 0, settlementStatus: null });
  for (const bill of countedBills) {
    const row = performance.get(bill.agentId);
    if (!row) continue;
    row.allSales += Number(bill.totalStake);
    row.allBills += 1;
    if (selectedAllDraws || bill.drawId === currentDraw?.id) { row.currentSales += Number(bill.totalStake); row.currentBills += 1; }
  }
  for (const settlement of settlements) {
    const row = performance.get(settlement.agentId);
    if (!row) continue;
    row.allCommission += Number(settlement.commission);
    row.allNet += Number(settlement.net);
    if (selectedAllDraws || settlement.drawId === currentDraw?.id) {
      if (!selectedAllDraws) row.currentSales = Number(settlement.gross);
      row.currentPayout += Number(settlement.payout);
      row.currentCommission += Number(settlement.commission);
      row.currentNet += Number(settlement.net);
      row.settlementStatus = selectedAllDraws ? "AGGREGATED" : settlement.status;
    }
  }
  const rankedAgents = agents.map((agent) => ({ agent, stats: performance.get(agent.id)! })).sort((a, b) => b.stats.currentSales - a.stats.currentSales || b.stats.allSales - a.stats.allSales);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rankedAgents.length / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageAgents = rankedAgents.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedBillsByAgent = new Map<string, typeof countedBills>();
  for (const bill of countedBills) {
    if (currentDraw && bill.drawId !== currentDraw.id) continue;
    const agentBills = selectedBillsByAgent.get(bill.agentId) ?? [];
    agentBills.push(bill);
    selectedBillsByAgent.set(bill.agentId, agentBills);
  }
  const customersByAgent = new Map(
    rankedAgents.map(({ agent }) => [agent.id, aggregateAgentCustomers(selectedBillsByAgent.get(agent.id) ?? [])]),
  );
  const organizationRows = pageAgents.map(({ agent }) => {
    const customers = customersByAgent.get(agent.id) ?? [];
    return { agent, customers, topCustomers: customers.slice(0, 5) };
  });
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const item = Array.isArray(value) ? value[0] : value;
      if (item && key !== "page") params.set(key, item);
    }
    if (page > 1) params.set("page", String(page));
    return `/agents${params.size ? `?${params}` : ""}`;
  };
  const totalCurrentSales = rankedAgents.reduce((sum, row) => sum + row.stats.currentSales, 0);
  const totalCurrentBills = rankedAgents.reduce((sum, row) => sum + row.stats.currentBills, 0);
  const activeAgentCount = rankedAgents.filter(({ agent }) => agent.status === "ACTIVE").length;
  const totalCustomerCount = rankedAgents.reduce((sum, { agent }) => sum + (customersByAgent.get(agent.id)?.length ?? 0), 0);
  const maxCurrentSales = Math.max(...rankedAgents.map((row) => row.stats.currentSales), 1);
  const selectedDrawLabel = selectedAllDraws
    ? "งวดทั้งหมด"
    : currentDraw?.name ?? "ยังไม่มีงวดปัจจุบัน";

  return (
    <main className="agents-page">
      <header className="agents-hero"><div className="agents-hero-copy"><p><Link href="/">← หน้าภาพรวม</Link></p><div className="agents-title-row"><span className="agents-title-icon"><DashboardIcon name="agent" /></span><div><span className="agents-eyebrow">Organization & Customer View</span><h1 id="agents-heading">Agent และลูกค้าที่ดูแล</h1><p>ดูโครงสร้าง Agent ลูกค้าหลัก และผลงานจริงจากบิลที่ยืนยันแล้วในหน้าเดียว</p></div></div></div><div className="agents-current-draw"><span>ข้อมูลที่กำลังติดตาม</span><strong>{selectedDrawLabel}</strong><small>{drawOptions.length > 0 ? "เลือกดูได้ทั้งภาพรวมและงวดเฉพาะ" : "ยังไม่มีข้อมูลงวดสำหรับแสดงผล"}</small></div></header>

      <AgentDashboardFilters draws={drawOptions.map((draw) => ({ id: draw.id, name: draw.name }))} agents={allAgents.map((agent) => ({ id: agent.id, code: agent.code, name: agent.name }))} />

      <section className="agent-kpis" aria-label="สรุปผลงาน Agent">
        <article><span className="agent-kpi-icon"><DashboardIcon name="agent" /></span><div><span>Agent ทั้งหมด</span><strong>{rankedAgents.length}</strong><small>คน · ตามตัวกรองที่เลือก</small></div></article>
        <article><span className="agent-kpi-icon tone-green"><DashboardIcon name="check" /></span><div><span>กำลังใช้งาน</span><strong>{activeAgentCount}</strong><small>คน · สถานะพร้อมขาย</small></div></article>
        <article><span className="agent-kpi-icon tone-blue"><DashboardIcon name="winner" /></span><div><span>ลูกค้าทั้งหมด</span><strong>{totalCustomerCount}</strong><small>คน · รวมตาม Agent ที่ดูแล</small></div></article>
        <article><span className="agent-kpi-icon tone-teal"><DashboardIcon name="wallet" /></span><div><span>ยอดขายรวม</span><strong>{MONEY.format(totalCurrentSales)}</strong><small>บาท · {totalCurrentBills} บิล</small></div></article>
      </section>

      <section className="agent-organization-card" aria-labelledby="organization-heading">
        <div className="agent-section-heading"><div><span className="agents-eyebrow">Organization Chart</span><h2 id="organization-heading">โครงสร้าง Agent และลูกค้า</h2><p>ลูกค้า Top 5 เรียงตามยอดซื้อจริง หากมีมากกว่านี้สามารถดาวน์โหลดรายชื่อทั้งหมดเป็น CSV</p></div><div className="organization-legend" aria-label="ลำดับโครงสร้าง"><span>เจ้าของ</span><b>→</b><span>Agent</span><b>→</b><span>ลูกค้า</span></div></div>
        <div className="organization-root" aria-label="เจ้าขององค์กร"><span><DashboardIcon name="brand" /></span><div><small>เจ้าของกิจการ</small><strong>{organization?.name ?? "ภาพรวมองค์กร"}</strong></div></div>
        {organizationRows.length === 0 ? <p className="agent-empty">ไม่พบ Agent ตามตัวกรองที่เลือก</p> : <div className="organization-grid" aria-label="รายชื่อ Agent และลูกค้าที่ดูแล">{organizationRows.map(({ agent, customers, topCustomers }) => (
          <article className="organization-branch" key={agent.id}>
            <header><span><DashboardIcon name="agent" /></span><div><strong>{agent.code} · {agent.name}</strong><small>{customers.length} ลูกค้าในข้อมูลที่เลือก</small></div><i className={`agent-status-dot status-${agent.status.toLowerCase()}`}>{STATUS_LABEL[agent.status] ?? agent.status}</i></header>
            <Link className="organization-profile-link" href={`/agents/${agent.id}${currentDraw ? `?drawId=${currentDraw.id}` : ""}`}>ดูโปรไฟล์ Agent <DashboardIcon name="arrow" /></Link>
            <div className="organization-connector" aria-hidden="true" />
            {topCustomers.length === 0 ? <p className="organization-empty">ยังไม่มีลูกค้าในงวดนี้</p> : <ol>{topCustomers.map((customer, index) => <li key={customer.key}><b>{customer.name.trim().slice(0, 1) || index + 1}</b><Link href={`/customers/${customerProfileKey(customer.name)}`}><strong>{customer.name}</strong><small>{customer.billCount} บิล</small></Link><em><small>ยอดซื้อ</small>{MONEY.format(customer.gross)}</em></li>)}</ol>}
            <footer><Link href={`/agents/${agent.id}${currentDraw ? `?drawId=${currentDraw.id}` : ""}`}>ดูลูกค้าทั้งหมด</Link>{customers.length > 5 ? <a href={`/api/agents/${agent.id}/customers${currentDraw ? `?draw=${currentDraw.id}` : ""}`}>ดาวน์โหลด CSV ↓</a> : <span>แสดงครบ {customers.length} คนแล้ว</span>}</footer>
          </article>
        ))}</div>}
        {organizationRows.length > 1 && <p className="organization-scroll-hint">เลื่อนแนวนอนเพื่อดู Agent เพิ่มเติม →</p>}
        <p className="agent-data-note">ชื่อลูกค้าอ้างอิงจากชื่อบิล ลูกค้าชื่อเดียวกันจะถูกรวมเป็นคนเดียวกัน และเรียงตามยอดซื้อรวมจริง</p>
      </section>

      <section className="agent-performance-card" aria-labelledby="performance-heading">
        <div className="agent-section-heading"><div><span className="agents-eyebrow">ผลงานรายบุคคล</span><h2 id="performance-heading">Agent ขายเป็นอย่างไรบ้าง</h2></div><small>{selectedAllDraws ? "งวดทั้งหมด · เรียงตามยอดขายสะสม" : currentDraw ? `${currentDraw.name} · เรียงจากยอดขายสูงสุด` : "เรียงตามยอดขายสะสม"}</small></div>
        {rankedAgents.length === 0 ? <p className="agent-empty">ไม่พบ Agent ตามตัวกรองที่เลือก</p> : <div className="agent-compact-list">{pageAgents.map(({ agent, stats }, pageIndex) => {
          const index = (currentPage - 1) * pageSize + pageIndex;
          const share = totalCurrentSales ? stats.currentSales / totalCurrentSales * 100 : 0;
          const settlementLabel = stats.settlementStatus === "AGGREGATED" ? "รวมงวดที่คำนวณแล้ว" : stats.settlementStatus === "APPROVED" ? "อนุมัติแล้ว" : stats.settlementStatus === "RECONCILED" || stats.settlementStatus === "DRAFT" ? "คำนวณแล้ว" : "ยังไม่คำนวณ";
          return <article className="agent-compact-row" key={agent.id}>
            <div className="agent-card-person"><b>{index + 1}</b><Link className="agent-profile-entry" href={`/agents/${agent.id}${currentDraw ? `?drawId=${currentDraw.id}` : ""}`}><strong>{agent.code} · {agent.name}</strong><small>{STATUS_LABEL[agent.status]} · คอม {agent.commissionRate.toFixed(2)}% · ดูโปรไฟล์เชิงลึก →</small></Link></div>
            <div className="agent-compact-sales"><span>ยอดขาย</span><strong>{MONEY.format(stats.currentSales)}</strong><div><i style={{ width: `${stats.currentSales / maxCurrentSales * 100}%` }}/></div><small>{share.toFixed(1)}%</small></div>
            <div className="agent-compact-metric"><span>บิล</span><strong>{stats.currentBills}</strong></div>
            <div className="agent-compact-metric"><span>คอมจริง</span><strong>{stats.settlementStatus ? MONEY.format(stats.currentCommission) : "—"}</strong></div>
            <div className={`agent-compact-metric ${stats.currentNet < 0 ? "negative-value" : ""}`}><span>สุทธิ</span><strong>{stats.settlementStatus ? MONEY.format(stats.currentNet) : "—"}</strong></div>
            <span className={`settlement-chip ${stats.settlementStatus ? "ready" : "pending"}`}>{settlementLabel}</span>
          </article>;
        })}<nav className="agent-pagination" aria-label="แบ่งหน้ารายชื่อ Agent"><span>แสดง {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, rankedAgents.length)} จาก {rankedAgents.length} คน</span><div>{currentPage > 1 ? <Link href={pageHref(currentPage - 1)}>← ก่อนหน้า</Link> : <span>← ก่อนหน้า</span>}<b>{currentPage} / {totalPages}</b>{currentPage < totalPages ? <Link href={pageHref(currentPage + 1)}>ถัดไป →</Link> : <span>ถัดไป →</span>}</div></nav></div>}
        <p className="agent-data-note">ยอดขายและจำนวนบิลอ่านจากบิลที่ยืนยันแล้ว ส่วนยอดจ่าย คอมมิชชัน และสุทธิอ่านจาก Settlement ที่บันทึกจริง หากยังไม่คำนวณจะแสดง “—” แทนการประมาณค่า</p>
      </section>

    </main>
  );
}

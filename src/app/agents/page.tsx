import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listAgents } from "@/lib/agents/service";
import { prisma } from "@/lib/db";
import { CreateAgentForm, StatusForm } from "./AgentForms";
import { AgentDashboardFilters } from "./AgentDashboardFilters";
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
  if (!can(actor.role, "agent.manage")) redirect("/");

  const query = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const drawId = first(query.drawId);
  const status = first(query.status);
  const agentId = first(query.agentId);
  const search = first(query.q)?.trim().toLocaleLowerCase("th-TH") ?? "";
  const requestedPage = Math.max(1, Number.parseInt(first(query.page) ?? "1", 10) || 1);
  const drawOptions = await prisma.draw.findMany({ where: orgScope(actor), orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, cutoffAt: true } });
  const defaultDraw = drawOptions.find((draw) => ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED"].includes(draw.status)) ?? drawOptions[0] ?? null;
  const currentDraw = (drawId ? drawOptions.find((draw) => draw.id === drawId) : defaultDraw) ?? defaultDraw;
  const [allAgents, countedBills, settlements] = await Promise.all([
    listAgents(actor),
    prisma.bill.findMany({
      where: { ...orgScope(actor), status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } },
      select: { agentId: true, drawId: true, totalStake: true, totalPayout: true },
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
    if (bill.drawId === currentDraw?.id) { row.currentSales += Number(bill.totalStake); row.currentBills += 1; }
  }
  for (const settlement of settlements) {
    const row = performance.get(settlement.agentId);
    if (!row) continue;
    row.allCommission += Number(settlement.commission);
    row.allNet += Number(settlement.net);
    if (settlement.drawId === currentDraw?.id) {
      row.currentSales = Number(settlement.gross);
      row.currentPayout = Number(settlement.payout);
      row.currentCommission = Number(settlement.commission);
      row.currentNet = Number(settlement.net);
      row.settlementStatus = settlement.status;
    }
  }
  const rankedAgents = agents.map((agent) => ({ agent, stats: performance.get(agent.id)! })).sort((a, b) => b.stats.currentSales - a.stats.currentSales || b.stats.allSales - a.stats.allSales);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rankedAgents.length / pageSize));
  const currentPage = Math.min(requestedPage, totalPages);
  const pageAgents = rankedAgents.slice((currentPage - 1) * pageSize, currentPage * pageSize);
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
  const totalCurrentPayout = rankedAgents.reduce((sum, row) => sum + row.stats.currentPayout, 0);
  const totalCurrentCommission = rankedAgents.reduce((sum, row) => sum + row.stats.currentCommission, 0);
  const totalCurrentNet = rankedAgents.reduce((sum, row) => sum + row.stats.currentNet, 0);
  const hasCurrentSettlement = rankedAgents.some((row) => row.stats.settlementStatus !== null);
  const maxCurrentSales = Math.max(...rankedAgents.map((row) => row.stats.currentSales), 1);

  return (
    <main className="agents-page">
      <header className="agents-hero"><div><p><Link href="/">← หน้าภาพรวม</Link></p><span className="agents-eyebrow">Agent Performance</span><h1 id="agents-heading">ภาพรวมและจัดการ Agent</h1><p>ติดตามผลงานยอดขายของแต่ละคน พร้อมจัดการวงเงินและสถานะในหน้าเดียว</p></div><div className="agents-current-draw"><span>งวดที่กำลังติดตาม</span><strong>{currentDraw?.name ?? "ยังไม่มีงวดปัจจุบัน"}</strong><small>{currentDraw ? "ข้อมูลจะอัปเดตตามบิลที่ยืนยันแล้ว" : "สร้างรอบเพื่อเริ่มติดตามผลงาน"}</small></div></header>

      <AgentDashboardFilters draws={drawOptions.map((draw) => ({ id: draw.id, name: draw.name }))} agents={allAgents.map((agent) => ({ id: agent.id, code: agent.code, name: agent.name }))} />

      <section className="agent-kpis" aria-label="สรุปผลงาน Agent">
        <article><span>ยอดขายในรอบที่เลือก</span><strong>{MONEY.format(totalCurrentSales)}</strong><small>บาท · {totalCurrentBills} บิล</small></article>
        <article><span>จ่ายรางวัลจริง</span><strong>{MONEY.format(totalCurrentPayout)}</strong><small>{hasCurrentSettlement ? "บาท · จาก Settlement" : "ยังไม่ได้คำนวณ Settlement"}</small></article>
        <article><span>คอมมิชชันจริง</span><strong>{MONEY.format(totalCurrentCommission)}</strong><small>{hasCurrentSettlement ? "บาท · ใช้อัตรา Snapshot" : "ยังไม่ได้คำนวณ Settlement"}</small></article>
        <article className={totalCurrentNet < 0 ? "agent-kpi-negative" : ""}><span>สุทธิจริง</span><strong>{MONEY.format(totalCurrentNet)}</strong><small>{hasCurrentSettlement ? "ยอดขาย − รางวัล − คอม" : "รอ Settlement"}</small></article>
      </section>

      <section className="agent-performance-card" aria-labelledby="performance-heading">
        <div className="agent-section-heading"><div><span className="agents-eyebrow">ผลงานรายบุคคล</span><h2 id="performance-heading">Agent ขายเป็นอย่างไรบ้าง</h2></div><small>{currentDraw ? `${currentDraw.name} · เรียงจากยอดขายสูงสุด` : "เรียงตามยอดขายสะสม"}</small></div>
        {rankedAgents.length === 0 ? <p className="agent-empty">ไม่พบ Agent ตามตัวกรองที่เลือก</p> : <div className="agent-compact-list">{pageAgents.map(({ agent, stats }, pageIndex) => {
          const index = (currentPage - 1) * pageSize + pageIndex;
          const share = totalCurrentSales ? stats.currentSales / totalCurrentSales * 100 : 0;
          const settlementLabel = stats.settlementStatus === "APPROVED" ? "อนุมัติแล้ว" : stats.settlementStatus === "RECONCILED" ? "กระทบยอดแล้ว" : stats.settlementStatus === "DRAFT" ? "รอกระทบยอด" : "ยังไม่คำนวณ";
          return <article className="agent-compact-row" key={agent.id}>
            <div className="agent-card-person"><b>{index + 1}</b><span><strong>{agent.code} · {agent.name}</strong><small>{STATUS_LABEL[agent.status]} · คอม {agent.commissionRate.toFixed(2)}%</small></span></div>
            <div className="agent-compact-sales"><span>ยอดขาย</span><strong>{MONEY.format(stats.currentSales)}</strong><div><i style={{ width: `${stats.currentSales / maxCurrentSales * 100}%` }}/></div><small>{share.toFixed(1)}%</small></div>
            <div className="agent-compact-metric"><span>บิล</span><strong>{stats.currentBills}</strong></div>
            <div className="agent-compact-metric"><span>คอมจริง</span><strong>{stats.settlementStatus ? MONEY.format(stats.currentCommission) : "—"}</strong></div>
            <div className={`agent-compact-metric ${stats.currentNet < 0 ? "negative-value" : ""}`}><span>สุทธิ</span><strong>{stats.settlementStatus ? MONEY.format(stats.currentNet) : "—"}</strong></div>
            <span className={`settlement-chip ${stats.settlementStatus ? "ready" : "pending"}`}>{settlementLabel}</span>
          </article>;
        })}<nav className="agent-pagination" aria-label="แบ่งหน้ารายชื่อ Agent"><span>แสดง {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, rankedAgents.length)} จาก {rankedAgents.length} คน</span><div>{currentPage > 1 ? <Link href={pageHref(currentPage - 1)}>← ก่อนหน้า</Link> : <span>← ก่อนหน้า</span>}<b>{currentPage} / {totalPages}</b>{currentPage < totalPages ? <Link href={pageHref(currentPage + 1)}>ถัดไป →</Link> : <span>ถัดไป →</span>}</div></nav></div>}
        <p className="agent-data-note">ยอดขายและจำนวนบิลอ่านจากบิลที่ยืนยันแล้ว ส่วนยอดจ่าย คอมมิชชัน และสุทธิอ่านจาก Settlement ที่บันทึกจริง หากยังไม่คำนวณจะแสดง “—” แทนการประมาณค่า</p>
      </section>

      <details className="card agent-management-card">
        <summary><span><span className="agents-eyebrow">Agent Management</span><strong id="agents-management-heading">ตั้งค่า สถานะ และเพิ่ม Agent</strong><small>คลิกเพื่อเปิดส่วนจัดการ</small></span><b>เปิด</b></summary>
        <div className="agent-management-content">

        <table>
          <thead>
            <tr>
              <th scope="col">รหัส</th>
              <th scope="col">ชื่อ</th>
              <th scope="col">บัญชีผู้ใช้</th>
              <th scope="col">คอม (%)</th>
              <th scope="col">วงเงินต่อรอบ</th>
              <th scope="col">วงเงินต่อเลข</th>
              <th scope="col">บิล</th>
              <th scope="col">สถานะ</th>
              <th scope="col">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td>{agent.code}</td>
                <td>{agent.name}</td>
                <td>{agent.user?.login ?? <span className="muted">ยังไม่ผูก</span>}</td>
                <td>{agent.commissionRate.toFixed(2)}</td>
                <td>
                  {agent.creditLimit === null ? (
                    <span className="muted">ไม่จำกัด</span>
                  ) : (
                    agent.creditLimit.toFixed(2)
                  )}
                </td>
                <td>
                  {agent.perNumberLimit === null ? (
                    <span className="muted">ไม่จำกัด</span>
                  ) : (
                    agent.perNumberLimit.toFixed(2)
                  )}
                </td>
                <td>{agent._count.bills}</td>
                <td>{STATUS_LABEL[agent.status] ?? agent.status}</td>
                <td>
                  <StatusForm agentId={agent.id} currentStatus={agent.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="agent-create-heading">เพิ่ม Agent ใหม่</h2>
        <p className="muted">
          Agent ที่สร้างใหม่จะยังไม่มีบัญชีผู้ใช้ ต้องผูกบัญชีให้ก่อนจึงจะ login สร้างบิลได้
        </p>
        <CreateAgentForm />
        </div>
      </details>
    </main>
  );
}

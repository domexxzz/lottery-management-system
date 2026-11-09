import Link from "next/link";
import { DashboardHeading } from "./DashboardHeading";
import type { Actor } from "@/lib/auth/context";
import { orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { statusLabel } from "@/lib/bills/lifecycle";
import { DashboardIcon as Icon } from "./DashboardIcon";
import { AgentRoundSwitcher } from "./AgentRoundSwitcher";
import "./agent-dashboard.css";

const COUNTED = ["CONFIRMED", "LOCKED", "SETTLED"] as const;
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TIME = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" });
const DAY = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });

export async function AgentDashboard({ actor, drawId }: { actor: Actor; drawId?: string }) {
  const scope = orgScope(actor); const agentId = actor.agentId ?? "__no_agent__";
  const [agent, draws] = await Promise.all([
    prisma.agent.findFirst({ where: { ...scope, id: agentId }, select: { id: true, code: true, name: true, commissionRate: true, creditLimit: true, perNumberLimit: true } }),
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, take: 50, select: { id: true, name: true, status: true, cutoffAt: true } }),
  ]);
  const selectedDraw = drawId ? draws.find((draw) => draw.id === drawId) ?? null : null;
  const activeDraw = draws.find((draw) => ["OPEN","LOCKED","RESULT_PENDING","SETTLED"].includes(draw.status)) ?? draws[0] ?? null;
  const creditDraw = selectedDraw ?? activeDraw;
  const billWhere = { ...scope, agentId, ...(selectedDraw ? { drawId: selectedDraw.id } : {}) };
  const nearCutoffEnd = new Date(Date.now() + 24 * 60 * 60 * 1000);
  // รวมยอดในฐานข้อมูลแทนการดึงบิลทุกใบของ Agent มาวนนับใน Node.js
  const [recentBills, statusRows, countedTotals, settlements, creditTotals, topNumberRows, rejectedEvidence, nearCutoffDraws] = await Promise.all([
    prisma.bill.findMany({ where: billWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5, select: { id: true, billNumber: true, title: true, status: true, totalStake: true, createdAt: true, _count: { select: { items: true } } } }),
    prisma.bill.groupBy({ by: ["status"], where: billWhere, _count: { _all: true } }),
    prisma.bill.aggregate({ where: { ...billWhere, status: { in: [...COUNTED] } }, _sum: { totalStake: true } }),
    // settlement มีได้ไม่เกินหนึ่งแถวต่องวดต่อ Agent จึงดึงตรง ๆ ได้
    prisma.settlement.findMany({ where: { ...scope, agentId, ...(selectedDraw ? { drawId: selectedDraw.id } : {}) }, select: { commission: true, status: true } }),
    creditDraw ? prisma.bill.aggregate({ where: { ...scope, agentId, drawId: creditDraw.id, status: { in: [...COUNTED] } }, _sum: { totalStake: true } }) : Promise.resolve(null),
    creditDraw ? prisma.billItem.groupBy({ by: ["number"], where: { bill: { ...scope, agentId, drawId: creditDraw.id, status: { in: [...COUNTED] } } }, _sum: { stake: true }, orderBy: { _sum: { stake: "desc" } }, take: 3 }) : Promise.resolve([]),
    prisma.billAttachment.count({ where: { ...scope, status: "REJECTED", replacedBy: null, bill: { agentId } } }),
    prisma.draw.count({ where: { ...scope, status: "OPEN", cutoffAt: { gt: new Date(), lte: nearCutoffEnd } } }),
  ]);
  const statusCount = (status: string) => statusRows.find((row) => row.status === status)?._count._all ?? 0;
  const totalBills = statusRows.reduce((sum, row) => sum + row._count._all, 0);
  const countedCount = COUNTED.reduce((sum, status) => sum + statusCount(status), 0);
  const gross = Number(countedTotals._sum.totalStake ?? 0);
  const commission = settlements.reduce((sum, row) => sum + Number(row.commission), 0);
  const creditGross = Number(creditTotals?._sum.totalStake ?? 0);
  // แนวโน้ม 7 วัน ดึงเฉพาะบิลในช่วงนั้น
  const trendEnd = recentBills[0]?.createdAt ?? new Date();
  const trendStart = new Date(trendEnd.getTime() - 7 * 86400000);
  const trendBills = await prisma.bill.findMany({ where: { ...billWhere, status: { in: [...COUNTED] }, createdAt: { gte: trendStart, lte: trendEnd } }, select: { createdAt: true, totalStake: true } });
  const creditLimit = Number(agent?.creditLimit ?? 0); const hasCreditLimit = agent?.creditLimit !== null && agent?.creditLimit !== undefined;
  const remainingCredit = hasCreditLimit ? Math.max(creditLimit - creditGross, 0) : null; const creditPercent = hasCreditLimit && creditLimit > 0 ? Math.min(creditGross / creditLimit * 100, 100) : 0;
  const statuses = { DRAFT: statusCount("DRAFT"), CONFIRMED: statusCount("CONFIRMED"), LOCKED: statusCount("LOCKED"), SETTLED: statusCount("SETTLED") };
  const totalStatus = Math.max(totalBills, 1); const draftEnd = statuses.DRAFT / totalStatus * 100; const confirmedEnd = draftEnd + statuses.CONFIRMED / totalStatus * 100; const lockedEnd = confirmedEnd + statuses.LOCKED / totalStatus * 100;
  const donut = `conic-gradient(#cbd5da 0 ${draftEnd}%,#15979a ${draftEnd}% ${confirmedEnd}%,#efb136 ${confirmedEnd}% ${lockedEnd}%,#77b9df ${lockedEnd}% 100%)`;
  const salesByDay = new Map<string,number>(); for (const bill of trendBills) { const key = DAY.format(bill.createdAt); salesByDay.set(key,(salesByDay.get(key)??0)+Number(bill.totalStake)); }
  const trend = Array.from({ length: 7 }, (_, index) => { const date = new Date(trendEnd.getTime() - (6-index)*86400000); const label = DAY.format(date); return { label, value: salesByDay.get(label) ?? 0 }; }); const maxTrend = Math.max(...trend.map((row) => row.value),1); const points = trend.map((row,index)=>({ ...row,x:24+index*108.5,y:150-row.value/maxTrend*112 })); const pointString=points.map((p)=>`${p.x},${p.y}`).join(" "); const area=`M ${points[0]?.x??24} 150 L ${points.map((p)=>`${p.x} ${p.y}`).join(" L ")} L ${points.at(-1)?.x??675} 150 Z`;
  const topNumbers: [string, number][] = topNumberRows.map((row) => [row.number, Number(row._sum.stake ?? 0)]); const perNumberLimit=Number(agent?.perNumberLimit??0);
  const draftCount=statuses.DRAFT;
  const taskDraw = creditDraw;
  const tasks=[
    { label:"บิลร่าง", count:draftCount, detail:draftCount?"ตรวจรายการและยืนยันก่อนงวดปิดรับ":"ไม่มีบิลร่างค้าง", href:"/bills?status=DRAFT", tone:draftCount?"normal":"ok" },
    { label:"หลักฐานถูกตีกลับ", count:rejectedEvidence, detail:rejectedEvidence?"เปิดบิลเพื่อแก้ไขและส่งหลักฐานใหม่":"ไม่มีหลักฐานที่ต้องแก้ไข", href:"/bills", tone:rejectedEvidence?"warning":"ok" },
    { label:"งวดใกล้ปิดรับ", count:nearCutoffDraws, detail:nearCutoffDraws?"ปิดรับภายใน 24 ชั่วโมง":"ไม่มีงวดใกล้ปิดรับ", href:taskDraw?`/draws/${taskDraw.id}`:"/draws", tone:nearCutoffDraws?"warning":"ok" },
  ];
  const dataScopeLabel = selectedDraw?.name ?? "ทุกงวด";
  const createDraw = selectedDraw?.status === "OPEN" ? selectedDraw : activeDraw?.status === "OPEN" ? activeDraw : null;

  return <main className="dashboard-body agent-home">
    <div className="agent-home-header">
      <DashboardHeading icon="agent" eyebrow="พื้นที่ทำงานตัวแทน" title="ภาพรวมการขายของฉัน">
        {agent ? `${agent.code} · ${agent.name}` : actor.displayName} · สร้างบิล ติดตามยอด และตรวจสอบวงเงิน
      </DashboardHeading>
      <AgentRoundSwitcher selectedId={selectedDraw?.id ?? "all"} draws={draws.map((draw) => ({ ...draw, cutoffAt: draw.cutoffAt.toISOString() }))} />
    </div>
    <div className="agent-workflow"><Link href={createDraw?"/bills/new":"/bills"} className="agent-create-action"><Icon name={createDraw?"plus":"bill"}/>{createDraw?"สร้างบิลใหม่":"ดูรายการบิล"}</Link><ol><li><b>1</b>สร้างบิล</li><li>→</li><li><b>2</b>ตรวจรายการ</li><li>→</li><li><b>3</b>ยืนยันก่อนปิดรับ</li></ol></div>
    <section className="agent-home-kpis"><article><span><Icon name="report"/></span><div><small>ยอดขายของฉัน</small><strong>{MONEY.format(gross)}</strong><p>บาท · {dataScopeLabel}</p></div></article><article><span><Icon name="bill"/></span><div><small>จำนวนบิล</small><strong>{totalBills}</strong><p>{countedCount} บิลยืนยันแล้ว · {dataScopeLabel}</p></div></article><article><span><Icon name="agent"/></span><div><small>คอมมิชชันจริง</small><strong>{settlements.length?MONEY.format(commission):"—"}</strong><p>{settlements.length?selectedDraw?`Settlement ${settlements[0]?.status}`:`คำนวณแล้ว ${settlements.length} งวด`:`รอ Settlement · อัตราปัจจุบัน ${agent?.commissionRate.toFixed(2)??"0.00"}%`}</p></div></article><article><span><Icon name="book"/></span><div><small>วงเงินคงเหลือ</small><strong>{remainingCredit===null?"ไม่จำกัด":MONEY.format(remainingCredit)}</strong><p>{hasCreditLimit?`ใช้แล้ว ${creditPercent.toFixed(1)}% · ${creditDraw?.name??"ไม่มีงวด"}`:"ไม่มีการกำหนดวงเงิน"}</p><i><b style={{ width:`${creditPercent}%` }}/></i></div></article></section>
    <section className="agent-home-main"><article className="dashboard-panel"><div className="panel-heading"><div><p className="eyebrow">Sales Trend</p><h2>แนวโน้มยอดขาย 7 วัน</h2></div><Link href="/reports">ดูรายงาน <Icon name="arrow"/></Link></div><div className="agent-sales-chart"><svg viewBox="0 0 700 170" preserveAspectRatio="none"><defs><linearGradient id="agentArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#1697a6" stopOpacity=".3"/><stop offset="100%" stopColor="#1697a6" stopOpacity=".02"/></linearGradient></defs>{[38,75,112,150].map(y=><line key={y} x1="20" x2="680" y1={y} y2={y}/>)}<path d={area} fill="url(#agentArea)"/><polyline points={pointString}/>{points.map(p=><circle key={p.label} cx={p.x} cy={p.y} r="4" />)}</svg><div>{trend.map(row=><span key={row.label}>{row.label}</span>)}</div></div></article><article className="dashboard-panel agent-status-card"><div className="panel-heading"><div><p className="eyebrow">Bill Status</p><h2>สถานะบิล</h2></div></div><div className="agent-status-content"><div className="agent-status-donut" style={{ background:donut }}><span><strong>{totalBills}</strong><small>บิล</small></span></div><ul><li><i className="draft"/><span>แบบร่าง</span><b>{statuses.DRAFT}</b></li><li><i className="confirmed"/><span>ยืนยันแล้ว</span><b>{statuses.CONFIRMED}</b></li><li><i className="locked"/><span>ล็อกแล้ว</span><b>{statuses.LOCKED}</b></li><li><i className="settled"/><span>คำนวณแล้ว</span><b>{statuses.SETTLED}</b></li></ul></div></article></section>
    <section className="agent-home-middle"><article className="dashboard-panel"><div className="panel-heading"><div><p className="eyebrow">Today&apos;s Priorities</p><h2>งานที่ต้องทำวันนี้</h2></div></div><div className="agent-task-list">{tasks.map(task=><Link href={task.href} key={task.label} className={task.tone}><span><Icon name={task.tone==="warning"?"alert":"bill"}/></span><div><strong>{task.label}</strong><small>{task.detail}</small></div><b>{task.count}</b><Icon name="arrow"/></Link>)}</div></article><article className="dashboard-panel agent-credit-card"><div className="panel-heading"><div><p className="eyebrow">Credit Usage</p><h2>การใช้วงเงิน · {creditDraw?.name??"ไม่มีงวด"}</h2></div></div><div className="credit-summary"><p><span>วงเงินรวมของงวดนี้</span><strong>{hasCreditLimit?MONEY.format(creditLimit):"ไม่จำกัด"}</strong></p><p><span>ใช้ไปแล้ว</span><strong>{MONEY.format(creditGross)}</strong></p><p><span>คงเหลือ</span><strong>{remainingCredit===null?"ไม่จำกัด":MONEY.format(remainingCredit)}</strong></p><div><i style={{ width:`${creditPercent}%` }}/></div></div>{agent?.perNumberLimit&&<div className="number-exposure"><h3>เลขที่ใช้วงเงินสูงสุด</h3>{topNumbers.map(([number,value],index)=>{const percent=Math.min(value/perNumberLimit*100,100);return <p key={number}><b>{index+1}</b><span><strong>{number}</strong><small>{MONEY.format(value)} บาท</small></span><i><u style={{ width:`${percent}%` }}/></i><em>{percent.toFixed(0)}%</em></p>})}</div>}</article></section>
    <section className="dashboard-panel agent-recent"><div className="panel-heading"><div><p className="eyebrow">Recent Bills</p><h2>บิลล่าสุดของฉัน</h2></div><Link href="/bills">ดูทั้งหมด <Icon name="arrow"/></Link></div>{totalBills===0?<p className="empty-state">ยังไม่มีบิลในงวดนี้</p>:<div className="table-wrap"><table><thead><tr><th>เลขบิล</th><th>ลูกค้า/ชื่อบิล</th><th>รายการ</th><th className="num">ยอดขาย</th><th>เวลา</th><th>สถานะ</th></tr></thead><tbody>{recentBills.map(bill=><tr key={bill.id}><td><Link href={`/bills/${bill.id}`}>{bill.billNumber??"บิลร่าง"}</Link></td><td>{bill.title}</td><td>{bill._count.items}</td><td className="num">{MONEY.format(Number(bill.totalStake))}</td><td>{TIME.format(bill.createdAt)}</td><td><span className={`status-chip status-${bill.status.toLowerCase()}`}>{statusLabel(bill.status)}</span></td></tr>)}</tbody></table></div>}</section>
  </main>;
}

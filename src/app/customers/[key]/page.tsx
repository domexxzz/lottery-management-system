import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { BillStatus, Prisma } from "@prisma/client";
import { billScope, getActor, orgScope } from "@/lib/auth/context";
import { statusLabel } from "@/lib/bills/lifecycle";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { customerNameFromProfileKey } from "@/lib/customers/profile-key";
import { prisma } from "@/lib/db";
import { DashboardIcon as Icon } from "@/app/DashboardIcon";
import "./profile.css";

export const dynamic = "force-dynamic";

const COUNTED_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

export default async function CustomerProfilePage({ params }: { params: Promise<{ key: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const { key } = await params;
  const customerName = customerNameFromProfileKey(key);
  if (!customerName) notFound();

  const customerWhere: Prisma.BillWhereInput = {
    ...billScope(actor),
    title: { equals: customerName, mode: "insensitive" },
    status: { in: COUNTED_STATUSES },
  };

  const [
    billTotals,
    itemTotals,
    recentBills,
    winningBills,
    winningItemCount,
    winningItems,
    billDates,
    drawGroups,
    agentGroups,
    prizeGroups,
    numberGroups,
  ] = await Promise.all([
    prisma.bill.aggregate({ where: customerWhere, _count: { _all: true }, _sum: { totalStake: true, totalPayout: true } }),
    prisma.billItem.aggregate({ where: { bill: customerWhere }, _count: { _all: true } }),
    prisma.bill.findMany({ where: customerWhere, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, drawSequence: true, status: true, totalStake: true, totalPayout: true, createdAt: true, draw: { select: { id: true, name: true } }, agent: { select: { id: true, code: true, name: true } }, _count: { select: { items: true } } } }),
    prisma.bill.count({ where: { ...customerWhere, totalPayout: { gt: 0 } } }),
    prisma.billItem.count({ where: { isWinner: true, bill: customerWhere } }),
    prisma.billItem.findMany({
      where: { isWinner: true, bill: customerWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        number: true,
        stake: true,
        payout: true,
        prizeType: { select: { code: true, name: true } },
        bill: {
          select: {
            id: true,
            drawSequence: true,
            draw: { select: { id: true, name: true, cutoffAt: true } },
          },
        },
      },
    }),
    prisma.bill.aggregate({ where: customerWhere, _min: { createdAt: true }, _max: { createdAt: true } }),
    prisma.bill.groupBy({ by: ["drawId"], where: customerWhere, _count: { _all: true }, _sum: { totalStake: true, totalPayout: true }, orderBy: { _sum: { totalStake: "desc" } } }),
    prisma.bill.groupBy({ by: ["agentId"], where: customerWhere, _count: { _all: true }, _sum: { totalStake: true } }),
    prisma.billItem.groupBy({ by: ["prizeTypeId"], where: { bill: customerWhere }, _count: { _all: true }, _sum: { stake: true, payout: true } }),
    prisma.billItem.groupBy({ by: ["number"], where: { bill: customerWhere }, _count: { _all: true }, _sum: { stake: true }, orderBy: { _count: { number: "desc" } }, take: 5 }),
  ]);

  if (billTotals._count._all === 0) notFound();

  const drawIds = drawGroups.map((row) => row.drawId);
  const agentIds = agentGroups.map((row) => row.agentId);
  const prizeTypeIds = prizeGroups.map((row) => row.prizeTypeId);
  const [draws, agents, prizeTypes] = await Promise.all([
    drawIds.length ? prisma.draw.findMany({ where: { ...orgScope(actor), id: { in: drawIds } }, select: { id: true, name: true, cutoffAt: true } }) : [],
    agentIds.length ? prisma.agent.findMany({ where: { ...orgScope(actor), id: { in: agentIds } }, select: { id: true, code: true, name: true } }) : [],
    prizeTypeIds.length ? prisma.prizeType.findMany({ where: { ...orgScope(actor), id: { in: prizeTypeIds } }, select: { id: true, code: true, name: true } }) : [],
  ]);

  const gross = Number(billTotals._sum.totalStake ?? 0);
  const payout = Number(billTotals._sum.totalPayout ?? 0);
  const billCount = billTotals._count._all;
  const itemCount = itemTotals._count._all;
  const averageBill = billCount > 0 ? gross / billCount : 0;
  const drawById = new Map(draws.map((draw) => [draw.id, draw]));
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const prizeById = new Map(prizeTypes.map((prize) => [prize.id, prize]));
  const drawRows = drawGroups.map((row) => ({ draw: drawById.get(row.drawId), bills: row._count._all, gross: Number(row._sum.totalStake ?? 0), payout: Number(row._sum.totalPayout ?? 0) })).filter((row) => row.draw).sort((a, b) => b.draw!.cutoffAt.getTime() - a.draw!.cutoffAt.getTime());
  const agentRows = agentGroups.map((row) => ({ agent: agentById.get(row.agentId), bills: row._count._all, gross: Number(row._sum.totalStake ?? 0) })).filter((row) => row.agent).sort((a, b) => b.gross - a.gross);
  const topPrizes = prizeGroups.map((row) => ({ prize: prizeById.get(row.prizeTypeId), count: row._count._all, stake: Number(row._sum.stake ?? 0), payout: Number(row._sum.payout ?? 0) })).filter((row) => row.prize).sort((a, b) => b.stake - a.stake).slice(0, 5);
  const maxPrizeStake = Math.max(...topPrizes.map((row) => row.stake), 1);
  const initials = customerName.replace(/^ลูกค้า\s*/u, "").split(/\s+/u).map((part) => part[0]).join("").slice(0, 2) || "ล";
  const winRate = billCount > 0 ? winningBills / billCount * 100 : 0;
  const payoutRatio = gross > 0 ? payout / gross * 100 : 0;
  const primaryAgent = agentRows[0]?.agent;
  const latestBill = recentBills[0];

  return <main className="customer-profile-page">
    <div className="customer-topbar"><p className="customer-back"><Link href="/bills">← กลับหน้ารายการบิล</Link></p><span>ข้อมูลแบบอ่านอย่างเดียว</span></div>
    <header className="customer-hero"><div className="customer-identity"><span>{initials}</span><div><p>Customer Profile</p><h1>{customerName}</h1><div className="customer-tags"><b>{billCount > 1 ? "ลูกค้าซื้อซ้ำ" : "ลูกค้าใหม่"}</b>{winningBills > 0 && <b className="winner-tag">เคยถูกรางวัล</b>}<small>ข้อมูลจากชื่อบิลเดียวกัน</small></div></div></div><div className="customer-hero-side"><div className="customer-period"><span>เริ่มซื้อครั้งแรก</span><strong>{billDates._min.createdAt ? DATE_TIME.format(billDates._min.createdAt) : "—"}</strong><small>ล่าสุด {billDates._max.createdAt ? DATE_TIME.format(billDates._max.createdAt) : "—"}</small></div>{latestBill && <Link className="latest-bill-link" href={`/bills/${latestBill.id}#bill-items`}><span>บิลล่าสุด</span><strong>{visibleBillNumber(latestBill.drawSequence)}</strong><b>เปิดดูรายการ →</b></Link>}</div></header>

    <section className="customer-kpis" aria-label="สรุปลูกค้า"><article><span><Icon name="bill" /></span><div><small>ยอดซื้อสะสม</small><strong>{MONEY.format(gross)}</strong><em>บาท</em></div></article><article><span><Icon name="draw" /></span><div><small>บิล / รายการ</small><strong>{billCount} / {itemCount}</strong><em>ซื้อทั้งหมด {drawRows.length} งวด</em></div></article><article className="winner"><span><Icon name="winner" /></span><div><small>ถูกรางวัล</small><strong>{winningItemCount} รายการ</strong><em>{winningBills} บิล · รับรางวัล {MONEY.format(payout)} บาท</em></div></article><article><span><Icon name="analytics" /></span><div><small>ยอดเฉลี่ยต่อบิล</small><strong>{MONEY.format(averageBill)}</strong><em>{agentRows.length} Agent ที่รับบิล</em></div></article></section>

    <section className="customer-snapshot" aria-label="ภาพรวมพฤติกรรม"><div><small>อัตราบิลถูกรางวัล</small><strong>{winRate.toFixed(1)}%</strong><span><i style={{ width: `${Math.min(winRate, 100)}%` }} /></span></div><div><small>สัดส่วนรางวัลต่อยอดซื้อ</small><strong>{payoutRatio.toFixed(1)}%</strong><span><i style={{ width: `${Math.min(payoutRatio, 100)}%` }} /></span></div><div><small>Agent หลัก</small><strong>{primaryAgent ? `${primaryAgent.code} · ${primaryAgent.name}` : "—"}</strong><em>{agentRows[0] ? `${agentRows[0].bills} บิล · ${MONEY.format(agentRows[0].gross)} บาท` : "ยังไม่มีข้อมูล"}</em></div></section>

    <section className="customer-panel customer-winning-history" aria-label="ประวัติการถูกรางวัล">
      <header><div><p>Prize History</p><h2>ประวัติการถูกรางวัล</h2></div><span>{winningItemCount} รายการ</span></header>
      {winningItems.length === 0 ? <p className="customer-empty">ลูกค้ารายนี้ยังไม่มีประวัติถูกรางวัล</p> : <><div className="customer-table-wrap"><table><thead><tr><th>งวด</th><th>เลขบิล</th><th>ประเภทรางวัล</th><th>เลขที่ถูก</th><th className="num">เงินที่ลง</th><th className="num">เงินรางวัล</th></tr></thead><tbody>{winningItems.map((item) => <tr key={item.id}><td><Link href={`/draws/${item.bill.draw.id}`}>{item.bill.draw.name}</Link><small>{DATE_TIME.format(item.bill.draw.cutoffAt)}</small></td><td><Link href={`/bills/${item.bill.id}#bill-items`}>{visibleBillNumber(item.bill.drawSequence)}</Link></td><td><strong>{item.prizeType.code}. {item.prizeType.name}</strong></td><td><b className="winning-number">{item.number}</b></td><td className="num">{MONEY.format(Number(item.stake))}</td><td className="num payout">{MONEY.format(Number(item.payout))}</td></tr>)}</tbody></table></div>{winningItemCount > winningItems.length && <p className="customer-history-note">แสดง 100 รายการล่าสุดจากทั้งหมด {winningItemCount} รายการ</p>}</>}
    </section>

    <section className="customer-insight-grid">
      <article className="customer-panel"><header><div><p>Purchase History</p><h2>พฤติกรรมแยกตามงวด</h2></div><span>{drawRows.length} งวด</span></header><div className="customer-table-wrap"><table><thead><tr><th>งวด</th><th className="num">บิล</th><th className="num">ยอดซื้อ</th><th className="num">รับรางวัล</th></tr></thead><tbody>{drawRows.map((row) => <tr key={row.draw!.id}><td><Link href={`/draws/${row.draw!.id}`}>{row.draw!.name}</Link><small>{DATE_TIME.format(row.draw!.cutoffAt)}</small></td><td className="num">{row.bills}</td><td className="num">{MONEY.format(row.gross)}</td><td className={`num ${row.payout > 0 ? "payout" : ""}`}>{MONEY.format(row.payout)}</td></tr>)}</tbody></table></div></article>
      <article className="customer-panel"><header><div><p>Product Preference</p><h2>ประเภทรางวัลที่ซื้อบ่อย</h2></div><span>Top 5</span></header>{topPrizes.length === 0 ? <p className="customer-empty">ยังไม่มีข้อมูล</p> : <div className="customer-prize-list">{topPrizes.map((row, index) => <div key={row.prize!.id}><b>{index + 1}</b><div><strong>{row.prize!.code}. {row.prize!.name}</strong><span><i style={{ width: `${row.stake / maxPrizeStake * 100}%` }} /></span><small>{row.count} รายการ · รับรางวัล {MONEY.format(row.payout)}</small></div><em>{MONEY.format(row.stake)}</em></div>)}</div>}</article>
      <article className="customer-panel number-panel"><header><div><p>Number Preference</p><h2>เลขที่ซื้อบ่อย</h2></div><span>Top 5</span></header>{numberGroups.length === 0 ? <p className="customer-empty">ยังไม่มีข้อมูล</p> : <div className="customer-number-list">{numberGroups.map((row, index) => <div key={row.number}><b>{index + 1}</b><strong>{row.number}</strong><span>{row._count._all} ครั้ง</span><em>{MONEY.format(Number(row._sum.stake ?? 0))} บาท</em></div>)}</div>}</article>
      {actor.role !== "AGENT" && <article className="customer-panel agent-touchpoint-panel"><header><div><p>Agent Relationship</p><h2>Agent ที่รับบิล</h2></div><span>{agentRows.length} คน</span></header><div className="customer-agent-list">{agentRows.map((row) => (actor.role === "GODMODE" || actor.role === "OWNER") ? <Link key={row.agent!.id} href={`/agents/${row.agent!.id}`}><span>{row.agent!.code.slice(0, 2)}</span><div><strong>{row.agent!.code} · {row.agent!.name}</strong><small>{row.bills} บิล · ดูโปรไฟล์ Agent →</small></div><em>{MONEY.format(row.gross)}</em></Link> : <div className="customer-agent-row" key={row.agent!.id}><span>{row.agent!.code.slice(0, 2)}</span><div><strong>{row.agent!.code} · {row.agent!.name}</strong><small>{row.bills} บิล</small></div><em>{MONEY.format(row.gross)}</em></div>)}</div></article>}
    </section>

    <section className="customer-panel customer-recent"><header><div><p>Bill Timeline</p><h2>ประวัติบิลล่าสุด</h2></div><span>สูงสุด 20 บิล</span></header><div className="customer-table-wrap"><table><thead><tr><th>เลขบิล</th><th>งวด</th>{actor.role !== "AGENT" && <th>Agent</th>}<th>วันที่</th><th className="num">รายการ</th><th className="num">ยอดซื้อ</th><th className="num">รับรางวัล</th><th>สถานะ</th></tr></thead><tbody>{recentBills.map((bill) => <tr key={bill.id}><td><Link href={`/bills/${bill.id}#bill-items`}>{visibleBillNumber(bill.drawSequence)}</Link></td><td>{bill.draw.name}</td>{actor.role !== "AGENT" && <td>{bill.agent.code}<small>{bill.agent.name}</small></td>}<td>{DATE_TIME.format(bill.createdAt)}</td><td className="num">{bill._count.items}</td><td className="num">{MONEY.format(Number(bill.totalStake))}</td><td className={`num ${Number(bill.totalPayout) > 0 ? "payout" : ""}`}>{MONEY.format(Number(bill.totalPayout))}</td><td><b className={`customer-status status-${bill.status.toLowerCase()}`}>{statusLabel(bill.status)}</b></td></tr>)}</tbody></table></div></section>
  </main>;
}

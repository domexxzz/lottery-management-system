import Link from "next/link";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { notFound, redirect } from "next/navigation";
import type { BillStatus, Prisma } from "@prisma/client";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { statusLabel } from "@/lib/bills/lifecycle";
import { customerProfileKey } from "@/lib/customers/profile-key";
import { DashboardIcon as Icon } from "@/app/DashboardIcon";
import { AgentProfileFilter } from "./AgentProfileFilter";
import "./profile.css";

export const dynamic = "force-dynamic";

const COUNTED_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const AGENT_STATUS: Record<string, string> = { ACTIVE: "ใช้งาน", SUSPENDED: "ระงับ", CLOSED: "ปิด" };
const SETTLEMENT_STATUS: Record<string, string> = { DRAFT: "คำนวณแล้ว", RECONCILED: "คำนวณแล้ว", APPROVED: "ปิดบัญชีแล้ว" };

export default async function AgentProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ drawId?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/");

  const { id } = await params;
  const query = await searchParams;
  const scope = orgScope(actor);
  const [agent, draws] = await Promise.all([
    prisma.agent.findFirst({
      where: { ...scope, id },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        commissionRate: true,
        creditLimit: true,
        perNumberLimit: true,
        user: { select: { id: true, login: true, lastLoginAt: true } },
      },
    }),
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, cutoffAt: true } }),
  ]);
  if (!agent) notFound();

  const selectedDraw = query.drawId ? draws.find((draw) => draw.id === query.drawId) ?? null : null;
  const billWhere: Prisma.BillWhereInput = {
    ...scope,
    agentId: agent.id,
    status: { in: COUNTED_STATUSES },
    ...(selectedDraw ? { drawId: selectedDraw.id } : {}),
  };
  const settlementWhere: Prisma.SettlementWhereInput = {
    ...scope,
    agentId: agent.id,
    ...(selectedDraw ? { drawId: selectedDraw.id } : {}),
  };

  const [billTotals, itemTotals, winningCustomers, recentBills, billsByDraw, prizeGroups, winningItems, settlements] = await Promise.all([
    prisma.bill.aggregate({ where: billWhere, _count: { _all: true }, _sum: { totalStake: true, totalPayout: true } }),
    prisma.billItem.aggregate({ where: { bill: billWhere }, _count: { _all: true } }),
    prisma.bill.findMany({ where: { ...billWhere, totalPayout: { gt: 0 } }, distinct: ["title"], select: { title: true } }),
    prisma.bill.findMany({ where: billWhere, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, drawSequence: true, title: true, status: true, totalStake: true, totalPayout: true, createdAt: true, draw: { select: { name: true } }, _count: { select: { items: true } } } }),
    prisma.bill.groupBy({ by: ["drawId"], where: billWhere, _count: { _all: true }, _sum: { totalStake: true, totalPayout: true } }),
    prisma.billItem.groupBy({ by: ["prizeTypeId"], where: { bill: billWhere }, _count: { _all: true }, _sum: { stake: true, payout: true } }),
    prisma.billItem.count({ where: { bill: billWhere, isWinner: true } }),
    prisma.settlement.findMany({ where: settlementWhere, select: { drawId: true, gross: true, payout: true, commission: true, net: true, status: true, calculatedAt: true } }),
  ]);

  const gross = Number(billTotals._sum.totalStake ?? 0);
  const payout = Number(billTotals._sum.totalPayout ?? 0);
  const billCount = billTotals._count._all;
  const itemCount = itemTotals._count._all;
  const winnerCount = new Set(winningCustomers.map((bill) => bill.title.trim().toLocaleLowerCase("th-TH"))).size;
  const commission = settlements.reduce((sum, row) => sum + Number(row.commission), 0);
  const net = settlements.reduce((sum, row) => sum + Number(row.net), 0);
  const averageBill = billCount > 0 ? gross / billCount : 0;
  const winnerRate = billCount > 0 ? winnerCount / billCount * 100 : 0;
  const drawById = new Map(draws.map((draw) => [draw.id, draw]));
  const settlementByDraw = new Map(settlements.map((row) => [row.drawId, row]));
  const performanceRows = billsByDraw.map((row) => ({ draw: drawById.get(row.drawId), bills: row._count._all, gross: Number(row._sum.totalStake ?? 0), payout: Number(row._sum.totalPayout ?? 0), settlement: settlementByDraw.get(row.drawId) })).filter((row) => row.draw).sort((a, b) => b.draw!.cutoffAt.getTime() - a.draw!.cutoffAt.getTime());
  const prizeTypeIds = prizeGroups.map((row) => row.prizeTypeId);
  const prizeTypes = prizeTypeIds.length ? await prisma.prizeType.findMany({ where: { ...scope, id: { in: prizeTypeIds } }, select: { id: true, code: true, name: true } }) : [];
  const prizeById = new Map(prizeTypes.map((row) => [row.id, row]));
  const topPrizes = prizeGroups.map((row) => ({ prize: prizeById.get(row.prizeTypeId), count: row._count._all, stake: Number(row._sum.stake ?? 0), payout: Number(row._sum.payout ?? 0) })).filter((row) => row.prize).sort((a, b) => b.stake - a.stake).slice(0, 5);
  const maxPrizeStake = Math.max(...topPrizes.map((row) => row.stake), 1);
  const selectedLabel = selectedDraw?.name ?? "ข้อมูลทั้งหมด";

  return <main className="agent-profile-page">
    <p className="agent-profile-back"><Link href="/agents">← กลับหน้าจัดการ Agent</Link></p>
    <header className="agent-profile-hero">
      <div className="agent-profile-person"><span>{agent.code.slice(0, 2)}</span><div><p>Agent Intelligence Profile</p><h1>{agent.code} · {agent.name}</h1><div><b className={`profile-status status-${agent.status.toLowerCase()}`}>{AGENT_STATUS[agent.status]}</b><small>{agent.user ? `บัญชี ${agent.user.login}` : "ยังไม่ผูกบัญชีผู้ใช้"}</small></div></div></div>
      <div className="agent-profile-hero-actions">
        {/*
          * ปุ่มนี้ขึ้นเฉพาะเมื่อ Agent ผูกบัญชีผู้ใช้ไว้แล้ว
          * ถ้ายังไม่ผูกก็ไม่มีใครให้ทักและกดไปก็ได้แต่หน้าว่าง
          *
          * หน้านี้เปิดได้เฉพาะคนที่มีสิทธิ์ report.viewAllAgents ซึ่งคือ
          * Owner และ Admin ทั้งคู่คุยกับตัวแทนได้อยู่แล้วตามกฎใน policy.ts
          */}
        {agent.user && (
          <Link className="agent-profile-chat" href={`/messages?user=${agent.user.id}`}>
            ส่งข้อความ
          </Link>
        )}
        <AgentProfileFilter draws={draws.map((draw) => ({ id: draw.id, name: draw.name }))} />
      </div>
    </header>

    <section className="agent-profile-limits" aria-label="ข้อมูล Agent"><div><span>อัตราคอมมิชชัน</span><strong>{agent.commissionRate.toFixed(2)}%</strong></div><div><span>วงเงินต่องวด</span><strong>{agent.creditLimit ? `${MONEY.format(Number(agent.creditLimit))} บาท` : "ไม่จำกัด"}</strong></div><div><span>วงเงินต่อเลข</span><strong>{agent.perNumberLimit ? `${MONEY.format(Number(agent.perNumberLimit))} บาท` : "ไม่จำกัด"}</strong></div><div><span>เข้าใช้ล่าสุด</span><strong>{agent.user?.lastLoginAt ? DATE_TIME.format(agent.user.lastLoginAt) : "ยังไม่เคยเข้าใช้"}</strong></div></section>

    <section className="agent-profile-kpis" aria-label={`ตัวเลขสรุป ${selectedLabel}`}>
      <article><span><Icon name="bill" /></span><div><small>ยอดขาย</small><strong>{MONEY.format(gross)}</strong><em>{billCount} บิล · {itemCount} รายการ</em></div></article>
      <article><span><Icon name="winner" /></span><div><small>ลูกค้าถูกรางวัล</small><strong>{winnerCount} คน</strong><em>{winningItems} รายการที่ถูกรางวัล</em></div></article>
      <article><span><Icon name="draw" /></span><div><small>จ่ายรางวัล</small><strong>{MONEY.format(payout)}</strong><em>บาท · จากผลที่คำนวณแล้ว</em></div></article>
      <article><span><Icon name="agent" /></span><div><small>คอมมิชชันจริง</small><strong>{MONEY.format(commission)}</strong><em>บาท · จาก Settlement</em></div></article>
      <article className={net < 0 ? "negative" : "positive"}><span><Icon name="report" /></span><div><small>สุทธิ</small><strong>{MONEY.format(net)}</strong><em>ยอดขาย − รางวัล − คอม</em></div></article>
      <article><span><Icon name="analytics" /></span><div><small>ยอดเฉลี่ยต่อบิล</small><strong>{MONEY.format(averageBill)}</strong><em>อัตราบิลถูกรางวัล {winnerRate.toFixed(1)}%</em></div></article>
    </section>

    <section className="agent-profile-grid">
      <article className="agent-profile-panel performance-panel"><header><div><p>Round Performance</p><h2>ผลงานแยกตามงวด</h2></div><span>{performanceRows.length} งวด</span></header>{performanceRows.length === 0 ? <p className="profile-empty">ยังไม่มีข้อมูลในงวดที่เลือก</p> : <div className="profile-table-wrap"><table><thead><tr><th>งวด</th><th className="num">บิล</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th className="num">คอมมิชชัน</th><th className="num">สุทธิ</th><th>Settlement</th></tr></thead><tbody>{performanceRows.map((row) => <tr key={row.draw!.id}><td><Link href={`/draws/${row.draw!.id}`}>{row.draw!.name}</Link><small>{DATE_TIME.format(row.draw!.cutoffAt)}</small></td><td className="num">{row.bills}</td><td className="num">{MONEY.format(row.gross)}</td><td className="num">{MONEY.format(row.payout)}</td><td className="num">{row.settlement ? MONEY.format(Number(row.settlement.commission)) : "—"}</td><td className={`num ${row.settlement && Number(row.settlement.net) < 0 ? "negative-value" : ""}`}>{row.settlement ? MONEY.format(Number(row.settlement.net)) : "—"}</td><td><b className={`profile-settlement ${row.settlement ? "ready" : "pending"}`}>{row.settlement ? SETTLEMENT_STATUS[row.settlement.status] : "ยังไม่คำนวณ"}</b></td></tr>)}</tbody></table></div>}</article>

      <article className="agent-profile-panel prize-panel"><header><div><p>Sales Mix</p><h2>ประเภทรางวัลที่ขายดี</h2></div><span>Top 5</span></header>{topPrizes.length === 0 ? <p className="profile-empty">ยังไม่มีรายการขาย</p> : <div className="profile-prize-list">{topPrizes.map((row, index) => <div key={row.prize!.id}><b>{index + 1}</b><div><strong>{row.prize!.code}. {row.prize!.name}</strong><span><i style={{ width: `${row.stake / maxPrizeStake * 100}%` }} /></span><small>{row.count} รายการ · จ่าย {MONEY.format(row.payout)}</small></div><em>{MONEY.format(row.stake)}</em></div>)}</div>}</article>
    </section>

    <section className="agent-profile-panel recent-bills-panel"><header><div><p>Recent Activity</p><h2>บิลล่าสุดของ Agent</h2></div><Link href={`/bills?agent=${agent.id}${selectedDraw ? `&draw=${selectedDraw.id}` : "&scope=all"}`}>ดูบิลทั้งหมด →</Link></header>{recentBills.length === 0 ? <p className="profile-empty">ยังไม่มีบิล</p> : <div className="profile-table-wrap"><table><thead><tr><th>เลขบิล / ลูกค้า</th><th>งวด</th><th>วันที่</th><th className="num">รายการ</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th>สถานะ</th></tr></thead><tbody>{recentBills.map((bill) => <tr key={bill.id}><td><Link href={`/bills/${bill.id}#bill-items`}>{visibleBillNumber(bill.drawSequence)}</Link><Link className="profile-customer-link" href={`/customers/${customerProfileKey(bill.title)}`}>{bill.title} · ดูโปรไฟล์ →</Link></td><td>{bill.draw.name}</td><td>{DATE_TIME.format(bill.createdAt)}</td><td className="num">{bill._count.items}</td><td className="num">{MONEY.format(Number(bill.totalStake))}</td><td className="num">{MONEY.format(Number(bill.totalPayout))}</td><td><b className={`profile-bill-status status-${bill.status.toLowerCase()}`}>{statusLabel(bill.status)}</b></td></tr>)}</tbody></table></div>}</section>
  </main>;
}

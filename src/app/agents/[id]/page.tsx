import Link from "next/link";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { notFound, redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import type { BillStatus } from "@prisma/client";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { BET_STATUS_LABEL, betStatusOf } from "@/lib/bills/betting";
import { customerProfileKey } from "@/lib/customers/profile-key";
import { DashboardIcon as Icon } from "@/app/DashboardIcon";
import { AgentProfileFilter } from "./AgentProfileFilter";
import { drawCommission, summarizeCommissionRates, type DrawCommission } from "@/lib/agents/commission-basis";
import { CommissionRateNote } from "@/components/CommissionRateNote";
import { drawDay } from "@/lib/draws/range";
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
  searchParams: Promise<{ drawId?: string; billPage?: string }>;
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
        laoCommissionRate: true,
        commissionPromotionStartsOn: true,
        commissionPromotionEndsOn: true,
        commissionPromotionThaiMinGross: true,
        commissionPromotionLaoMinGross: true,
        commissionPromotionThaiRate: true,
        commissionPromotionLaoRate: true,
        creditLimit: true,
        perNumberLimit: true,
        user: { select: { id: true, login: true, lastLoginAt: true } },
      },
    }),
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, cutoffAt: true, drawDate: true, lotteryType: true } }),
  ]);
  if (!agent) notFound();

  const selectedDraw = query.drawId ? draws.find((draw) => draw.id === query.drawId) ?? null : null;
  const requestedBillPage = Number.parseInt(query.billPage ?? "1", 10);
  const billPage = selectedDraw && Number.isFinite(requestedBillPage) && requestedBillPage > 0
    ? Math.min(requestedBillPage, 100_000)
    : 1;
  const billPageSize = selectedDraw ? 20 : 8;
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
    prisma.bill.findMany({ where: billWhere, orderBy: { createdAt: "desc" }, skip: (billPage - 1) * billPageSize, take: billPageSize, select: { id: true, drawSequence: true, title: true, status: true, totalStake: true, totalPayout: true, createdAt: true, draw: { select: { name: true } }, _count: { select: { items: true } } } }),
    prisma.bill.groupBy({ by: ["drawId"], where: billWhere, _count: { _all: true }, _sum: { totalStake: true, totalPayout: true } }),
    prisma.billItem.groupBy({ by: ["prizeTypeId"], where: { bill: billWhere }, _count: { _all: true }, _sum: { stake: true, payout: true } }),
    prisma.billItem.count({ where: { bill: billWhere, isWinner: true } }),
    prisma.settlement.findMany({ where: settlementWhere, select: { drawId: true, gross: true, payout: true, commission: true, net: true, status: true, calculatedAt: true, commissionRateSnapshot: true, commissionBaseRateSnapshot: true, commissionPromotionApplied: true } }),
  ]);

  const gross = Number(billTotals._sum.totalStake ?? 0);
  const payout = Number(billTotals._sum.totalPayout ?? 0);
  const billCount = billTotals._count._all;
  const itemCount = itemTotals._count._all;
  const winnerCount = new Set(winningCustomers.map((bill) => bill.title.trim().toLocaleLowerCase("th-TH"))).size;
  const commissionRate = Number(agent.commissionRate);
  const laoCommissionRate = Number(agent.laoCommissionRate);
  const averageBill = billCount > 0 ? gross / billCount : 0;
  const winnerRate = billCount > 0 ? winnerCount / billCount * 100 : 0;
  const drawById = new Map(draws.map((draw) => [draw.id, draw]));
  const settlementByDraw = new Map(settlements.map((row) => [row.drawId, row]));
  /*
   * ค่าคอมคิดจากยอดขาย (COMMISSION_BASE = GROSS)
   *
   * งวดที่คำนวณแล้วใช้ยอดจริงจาก Settlement ส่วนงวดที่ยังไม่คำนวณประมาณจากกฎเดียวกัน
   * ของเดิมประมาณด้วยเรตปกติเสมอ งวดที่ยอดถึงเกณฑ์โปรโมชั่นแล้วจึงแสดงต่ำกว่าความจริง
   */
  const moneyOf = (drawId: string, drawGross: number, drawPayout: number) => {
    const settlement = settlementByDraw.get(drawId);
    const draw = drawById.get(drawId);
    const basis: DrawCommission = drawCommission({
      agent,
      lotteryType: draw?.lotteryType ?? "THAI_GOVERNMENT",
      drawDay: draw ? drawDay(draw) : "",
      gross: new Prisma.Decimal(drawGross),
      payout: new Prisma.Decimal(drawPayout),
      settlement,
    });
    const amount = Number(basis.commission);
    const drawNet = drawGross - amount;
    return { commission: amount, basis, estimated: basis.estimated, net: drawNet, payout: drawPayout, profit: drawNet - drawPayout };
  };
  const performanceRows = billsByDraw.map((row) => ({ draw: drawById.get(row.drawId), bills: row._count._all, gross: Number(row._sum.totalStake ?? 0), payout: Number(row._sum.totalPayout ?? 0), settlement: settlementByDraw.get(row.drawId), money: moneyOf(row.drawId, Number(row._sum.totalStake ?? 0), Number(row._sum.totalPayout ?? 0)) })).filter((row) => row.draw).sort((a, b) => b.draw!.cutoffAt.getTime() - a.draw!.cutoffAt.getTime());
  // ยอดรวมของทุกงวดในขอบเขตที่เลือก: ยอดสุทธิ = ยอดขาย − ค่าคอม · กำไร/ขาดทุน = ยอดสุทธิ − จ่ายรางวัล
  const thaiRates = summarizeCommissionRates(performanceRows.filter((row) => row.draw!.lotteryType === "THAI_GOVERNMENT").map((row) => row.money.basis));
  const laoRates = summarizeCommissionRates(performanceRows.filter((row) => row.draw!.lotteryType !== "THAI_GOVERNMENT").map((row) => row.money.basis));
  const promotionDraws = thaiRates.promotionDraws + laoRates.promotionDraws;
  const commissionByLottery = performanceRows.reduce((sum, row) => {
    if (row.draw!.lotteryType === "THAI_GOVERNMENT") sum.thai += row.money.commission;
    else sum.lao += row.money.commission;
    return sum;
  }, { thai: 0, lao: 0 });
  const commission = commissionByLottery.thai + commissionByLottery.lao;
  const hasEstimatedCommission = performanceRows.some((row) => row.money.estimated);
  const hasUnsettled = performanceRows.some((row) => !row.settlement);
  const net = gross - commission;
  const profit = net - payout;
  const prizeTypeIds = prizeGroups.map((row) => row.prizeTypeId);
  const prizeTypes = prizeTypeIds.length ? await prisma.prizeType.findMany({ where: { ...scope, id: { in: prizeTypeIds } }, select: { id: true, code: true, name: true } }) : [];
  const prizeById = new Map(prizeTypes.map((row) => [row.id, row]));
  const topPrizes = prizeGroups.map((row) => ({ prize: prizeById.get(row.prizeTypeId), count: row._count._all, stake: Number(row._sum.stake ?? 0), payout: Number(row._sum.payout ?? 0) })).filter((row) => row.prize).sort((a, b) => b.stake - a.stake).slice(0, 5);
  const maxPrizeStake = Math.max(...topPrizes.map((row) => row.stake), 1);
  const selectedLabel = selectedDraw?.name ?? "ข้อมูลทั้งหมด";
  const billPageCount = Math.max(Math.ceil(billCount / billPageSize), 1);
  if (selectedDraw && billCount > 0 && billPage > billPageCount) {
    redirect(`/agents/${agent.id}?drawId=${selectedDraw.id}&billPage=${billPageCount}#agent-bills`);
  }
  const billPageHref = (page: number) => {
    const params = new URLSearchParams();
    if (selectedDraw) params.set("drawId", selectedDraw.id);
    if (page > 1) params.set("billPage", String(page));
    const search = params.toString();
    return `/agents/${agent.id}${search ? `?${search}` : ""}#agent-bills`;
  };

  return <main className="agent-profile-page">
    <p className="agent-profile-back"><Link href={selectedDraw ? `/draws/${selectedDraw.id}` : "/agents"}>{selectedDraw ? `← กลับไปงวด ${selectedDraw.name}` : "← กลับหน้าจัดการ Agent"}</Link></p>
    <header className="agent-profile-hero">
      <div className="agent-profile-person"><span>{agent.code.slice(0, 2)}</span><div><p>Agent Intelligence Profile</p><h1>{agent.code} · {agent.name}</h1><div><b className={`profile-status status-${agent.status.toLowerCase()}`}>{AGENT_STATUS[agent.status]}</b><small>{agent.user ? `บัญชี ${agent.user.login}` : "ยังไม่ผูกบัญชีผู้ใช้"}</small></div></div></div>
      <div className="agent-profile-hero-actions">
        {agent.user && (
          <div className="agent-profile-buttons">
            {/* หน้าแก้ไขผู้ใช้ต้องมีสิทธิ์ user.manage จึงซ่อนปุ่มจากคนที่ไม่มีสิทธิ์ */}
            {can(actor.role, "user.manage") && (
              <Link className="agent-profile-edit" href={`/users/${agent.user.id}/edit`}>
                แก้ไขข้อมูล
              </Link>
            )}
          </div>
        )}
        <AgentProfileFilter draws={draws.map((draw) => ({ id: draw.id, name: draw.name, lotteryType: draw.lotteryType }))} />
      </div>
    </header>

    <p className="agent-profile-accounting"><Link href={`/reports/accounting?period=month&agentId=${agent.id}`}>ดูสรุปบัญชีของ Agent นี้ รายงวด / รายเดือน / รายปี →</Link></p>
    <section className="agent-profile-limits" aria-label="ข้อมูล Agent"><div><span>ค่าคอมหวยรัฐบาล</span><strong>{agent.commissionRate.toFixed(2)}%</strong></div><div><span>ค่าคอมหวยลาวและชุด</span><strong>{agent.laoCommissionRate.toFixed(2)}%</strong></div><div><span>วงเงินต่องวด</span><strong>{agent.creditLimit ? `${MONEY.format(Number(agent.creditLimit))} บาท` : "ไม่จำกัด"}</strong></div><div><span>วงเงินต่อเลข</span><strong>{agent.perNumberLimit ? `${MONEY.format(Number(agent.perNumberLimit))} บาท` : "ไม่จำกัด"}</strong></div><div><span>เข้าใช้ล่าสุด</span><strong>{agent.user?.lastLoginAt ? DATE_TIME.format(agent.user.lastLoginAt) : "ยังไม่เคยเข้าใช้"}</strong></div></section>

    <section className="agent-profile-kpis" aria-label={`ตัวเลขสรุป ${selectedLabel}`}>
      <article><span><Icon name="bill" /></span><div><small>{selectedDraw ? "ยอดขายงวดนี้" : "ยอดขายรวม"}</small><strong>{MONEY.format(gross)}</strong><em>เงินที่ลูกค้าแทงทั้งหมด · {billCount} บิล · เฉลี่ย {MONEY.format(averageBill)} บาท/บิล</em></div></article>
      <article className="agent-profile-commission-card"><span><Icon name="agent" /></span><div><small>ค่าคอม Agent</small><strong>{MONEY.format(commission)} <small>บาท</small></strong><div className="agent-profile-commission-breakdown"><span>หวยไทย <b>{MONEY.format(commissionByLottery.thai)}</b><CommissionRateNote baseRates={thaiRates.baseRates} promotionRates={thaiRates.promotionRates} promotionDraws={thaiRates.promotionDraws} fallbackRate={commissionRate} estimated={thaiRates.estimated} /></span><span>หวยลาวและหวยลาวชุด <b>{MONEY.format(commissionByLottery.lao)}</b><CommissionRateNote baseRates={laoRates.baseRates} promotionRates={laoRates.promotionRates} promotionDraws={laoRates.promotionDraws} fallbackRate={laoCommissionRate} estimated={laoRates.estimated} /></span><span className="total">ค่าคอมรวม <b>{MONEY.format(commission)}</b></span></div>{promotionDraws > 0 && <em className="agent-profile-promotion-note">เข้าเกณฑ์โปรโมชั่นแล้ว {promotionDraws} งวด · คิดค่าคอมด้วยอัตราโปรโมชั่นให้แล้ว</em>}{hasEstimatedCommission && <em>งวดที่ยังไม่ออกผลเป็นยอดประมาณ คิดเรตโปรโมชั่นให้ด้วยเมื่อยอดถึงเกณฑ์</em>}</div></article>
      <article><span><Icon name="report" /></span><div><small>ยอดสุทธิ</small><strong>{MONEY.format(net)}</strong><em>ยอดขาย − ค่าคอม (ยังไม่หักค่ารางวัล)</em></div></article>
      <article><span><Icon name="draw" /></span><div><small>จ่ายรางวัล</small><strong>{MONEY.format(payout)}</strong><em>เงินที่ต้องจ่ายลูกค้าที่ถูกรางวัล{hasUnsettled ? " · งวดที่ยังไม่ออกผลยังเป็น 0" : ""}</em></div></article>
      <article><span><Icon name="winner" /></span><div><small>ลูกค้าถูกรางวัล</small><strong>{winnerCount} คน</strong><em>{winningItems} รายการที่ถูก · {winnerRate.toFixed(1)}% ของบิล</em></div></article>
      <article className={profit < 0 ? "negative" : "positive"}><span><Icon name="analytics" /></span><div><small>{profit < 0 ? "ขาดทุน" : "กำไร"}</small><strong>{profit < 0 ? "−" : ""}{MONEY.format(Math.abs(profit))}</strong><em>ยอดสุทธิ − จ่ายรางวัล = เงินที่เราได้/เสียจริง</em></div></article>
    </section>

    <section className="agent-profile-grid">
      <article className="agent-profile-panel performance-panel"><header><div><p>Round Performance</p><h2>ผลงานแยกตามงวด</h2></div><span>{performanceRows.length} งวด</span></header>{performanceRows.length === 0 ? <p className="profile-empty">ยังไม่มีข้อมูลในงวดที่เลือก</p> : <div className="profile-table-wrap"><table><thead><tr><th>งวด</th><th className="num">บิล</th><th className="num">ยอดขาย</th><th className="num">ค่าคอม</th><th className="num">ยอดสุทธิ</th><th className="num">จ่ายรางวัล</th><th className="num">กำไร/ขาดทุน</th><th>Settlement</th></tr></thead><tbody>{performanceRows.map((row) => <tr key={row.draw!.id}><td><Link href={`/draws/${row.draw!.id}`}>{row.draw!.name}</Link><small>{DATE_TIME.format(row.draw!.cutoffAt)}</small></td><td className="num">{row.bills}</td><td className="num">{MONEY.format(row.gross)}</td><td className="num">{MONEY.format(row.money.commission)}<small className="agent-profile-rate">{Number(row.money.basis.rate).toLocaleString("th-TH", { maximumFractionDigits: 2 })}%{row.money.basis.promotionApplied && <b> โปรฯ</b>}{row.money.estimated && " ประมาณการ"}</small></td><td className="num">{MONEY.format(row.money.net)}</td><td className="num">{row.settlement ? MONEY.format(row.payout) : "รอผล"}</td><td className={`num ${row.money.profit < 0 ? "negative-value" : "positive-value"}`}>{row.settlement ? `${row.money.profit < 0 ? "−" : "+"}${MONEY.format(Math.abs(row.money.profit))}` : "รอผล"}</td><td><b className={`profile-settlement ${row.settlement ? "ready" : "pending"}`}>{row.settlement ? SETTLEMENT_STATUS[row.settlement.status] : "ยังไม่คำนวณ"}</b></td></tr>)}</tbody></table></div>}</article>

      <article className="agent-profile-panel prize-panel"><header><div><p>Sales Mix</p><h2>ประเภทรางวัลที่ขายดี</h2></div><span>Top 5</span></header>{topPrizes.length === 0 ? <p className="profile-empty">ยังไม่มีรายการขาย</p> : <div className="profile-prize-list">{topPrizes.map((row, index) => <div key={row.prize!.id}><b>{index + 1}</b><div><strong>{row.prize!.code}. {row.prize!.name}</strong><span><i style={{ width: `${row.stake / maxPrizeStake * 100}%` }} /></span><small>{row.count} รายการ · จ่าย {MONEY.format(row.payout)}</small></div><em>{MONEY.format(row.stake)}</em></div>)}</div>}</article>
    </section>

    <section className="agent-profile-panel recent-bills-panel" id="agent-bills">
      <header>
        <div><p>{selectedDraw ? "Draw Bills" : "Recent Activity"}</p><h2>{selectedDraw ? `บิลของงวด ${selectedDraw.name}` : "บิลล่าสุดของ Agent"}</h2></div>
        <span>{billCount.toLocaleString("th-TH")} บิล</span>
      </header>
      {recentBills.length === 0 ? <p className="profile-empty">ยังไม่มีบิลในงวดนี้</p> : <>
        <ol className="agent-bill-cards">
          {recentBills.map((bill, index) => {
            const betStatus = betStatusOf(bill);
            const payout = Number(bill.totalPayout);
            const position = (billPage - 1) * billPageSize + index + 1;
            return <li key={bill.id} className="agent-bill-card">
              <header>
                <div><span>{position}</span><p><small>เลขบิล</small><Link href={`/bills/${bill.id}`}>{visibleBillNumber(bill.drawSequence)}</Link></p></div>
                <b className={`agent-bill-state is-${betStatus.toLowerCase()}`}>{BET_STATUS_LABEL[betStatus]}</b>
              </header>
              <div className="agent-bill-owner">
                <p><small>ชื่อลูกค้า</small><Link href={`/customers/${customerProfileKey(bill.title)}`}>{bill.title}</Link></p>
                <p><small>ชื่อ Agent</small><strong>{agent.code} · {agent.name}</strong></p>
              </div>
              <div className="agent-bill-numbers">
                <div><small>🇹🇭 งวด</small><strong>{bill.draw.name}</strong></div>
                <div><small>ยอดเดิมพัน</small><strong>{MONEY.format(Number(bill.totalStake))} บาท</strong></div>
                <div><small>จำนวนเลข</small><strong>{bill._count.items.toLocaleString("th-TH")} รายการ</strong></div>
                <div><small>เงินรางวัล</small><strong className={payout > 0 ? "is-won" : undefined}>{payout > 0 ? `${MONEY.format(payout)} บาท` : "—"}</strong></div>
              </div>
              <footer><time dateTime={bill.createdAt.toISOString()}>▣ {DATE_TIME.format(bill.createdAt)}</time><Link className="profile-bill-detail" href={`/bills/${bill.id}`}>ดูรายละเอียด</Link></footer>
            </li>;
          })}
        </ol>
        {selectedDraw && billPageCount > 1 && <nav className="profile-bill-pagination" aria-label="เปลี่ยนหน้ารายการบิล">{billPage > 1 ? <Link href={billPageHref(billPage - 1)}>← ก่อนหน้า</Link> : <span>← ก่อนหน้า</span>}<b>หน้า {Math.min(billPage, billPageCount)} / {billPageCount}</b>{billPage < billPageCount ? <Link href={billPageHref(billPage + 1)}>ถัดไป →</Link> : <span>ถัดไป →</span>}</nav>}
      </>}
    </section>
  </main>;
}

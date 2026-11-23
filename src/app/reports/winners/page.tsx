import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { visibleBillNumber } from "@/lib/bills/numbering";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { loadWinningBillsReport } from "@/lib/reports/winning-bills";
import { parseWinningBillsQuery } from "@/lib/reports/winning-bills-query";
import { LotteryFlag } from "@/app/bills/ThaiFlag";
import "./winners.css";

export const dynamic = "force-dynamic";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

function href(values: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params.size ? `?${params}` : "";
}

export default async function WinningBillsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/bills");

  const raw = await searchParams;
  const query = parseWinningBillsQuery(raw);
  const report = await loadWinningBillsReport(actor, query);
  const backHref = href({
    lottery: query.lottery,
    drawId: query.dashboardDrawId,
    dateFrom: query.from,
    dateTo: query.to,
  });
  const pageHref = (page: number) => `/reports/winners${href({ lottery: query.lottery, draws: query.drawIds.join(","), dashboardDraw: query.dashboardDrawId, agent: query.agentId, from: query.from, to: query.to, page })}`;
  const firstRow = report.totalBills === 0 ? 0 : (report.page - 1) * report.pageSize + 1;
  const lastRow = Math.min(report.page * report.pageSize, report.totalBills);
  const scopeLabel = query.drawIds.length > 0
    ? `งวดที่เลือก ${query.drawIds.length > 1 ? `${query.drawIds.length} ประเภทหวย` : ""}`.trim()
    : query.lottery === "THAI_GOVERNMENT" ? "หวยรัฐบาลทุกงวด"
      : query.lottery === "LAO_COMBINED" ? "หวยลาวและหวยลาวชุดทุกงวด" : "ทุกประเภทและทุกงวด";

  return <main className="winner-report-page">
    <header className="winner-report-hero">
      <div>
        <p>รายงานผลรางวัล</p>
        <h1>บิลที่ถูกรางวัล</h1>
        <span>ดูว่า Agent คนไหนถูก เลขอะไร ประเภทรางวัลใด พร้อมยอดจ่ายและค่าคอม</span>
      </div>
      <Link href={`/${backHref}`} className="winner-report-back">← กลับหน้าภาพรวม</Link>
    </header>

    <section className="winner-report-scope" aria-label="ขอบเขตข้อมูล">
      <strong>{scopeLabel}</strong>
      {(query.from || query.to) && <span>วันที่สร้างบิล {query.from || "เริ่มต้น"} ถึง {query.to || "ปัจจุบัน"}</span>}
      {query.agentId && <span>กรอง Agent ที่เลือก</span>}
    </section>

    <section className="winner-report-kpis" aria-label="ยอดรวมบิลที่ถูกรางวัล">
      <article><small>บิลที่ถูกรางวัล</small><strong>{report.totalBills.toLocaleString("th-TH")}</strong><span>บิล</span></article>
      <article><small>ยอดเดิมพันในบิลถูกรางวัล</small><strong>{MONEY.format(report.totals.gross)}</strong><span>บาท</span></article>
      <article><small>จ่ายรางวัลทั้งหมด</small><strong>{MONEY.format(report.totals.payout)}</strong><span>บาท</span></article>
      <article><small>ค่าคอม Agent</small><strong>{MONEY.format(report.totals.commission)}</strong><span>บาท</span></article>
    </section>

    {report.totalBills === 0 ? <section className="winner-report-empty"><strong>ไม่พบบิลที่ถูกรางวัล</strong><span>ลองกลับไปเปลี่ยนประเภทหวย งวด หรือช่วงวันที่ในหน้าภาพรวม</span></section> : <>
      <div className="winner-report-result-count">แสดง {firstRow.toLocaleString("th-TH")}–{lastRow.toLocaleString("th-TH")} จาก {report.totalBills.toLocaleString("th-TH")} บิล</div>
      <div className="winner-agent-list">
        {report.agents.filter((agent) => agent.bills.length > 0).map((agent) => <section key={agent.agentId} className="winner-agent-section">
          <header>
            <div><small>Agent</small><h2>{agent.code} · {agent.name}</h2></div>
            <dl>
              <div><dt>บิลถูกทั้งหมด</dt><dd>{agent.billCount.toLocaleString("th-TH")} บิล</dd></div>
              <div><dt>จ่ายรางวัล</dt><dd>{MONEY.format(agent.payout)} บาท</dd></div>
              <div><dt>ค่าคอม</dt><dd>{MONEY.format(agent.commission)} บาท</dd></div>
            </dl>
          </header>
          <div className="winner-bill-grid">
            {agent.bills.map((bill) => <article key={bill.id} className="winner-bill-card">
              <header>
                <div><small>เลขบิล</small><strong>{visibleBillNumber(bill.drawSequence)}</strong><span>ลูกค้า: {bill.title || "ไม่ระบุชื่อ"}</span></div>
                <span className="winner-lottery-badge"><LotteryFlag lotteryType={bill.draw.lotteryType} />{lotteryLabel(bill.draw.lotteryType)}</span>
              </header>
              <div className="winner-draw-line"><span>{bill.draw.name} · งวด {drawDateLabel(bill.draw)}</span><time>{DATE_TIME.format(bill.createdAt)}</time></div>
              <div className="winner-finance-row">
                <div><small>ยอดเดิมพัน</small><strong>{MONEY.format(Number(bill.totalStake))}</strong></div>
                <div><small>จ่ายรางวัล</small><strong className="is-payout">{MONEY.format(Number(bill.totalPayout))}</strong></div>
                <div><small>ค่าคอม ({bill.commissionRate.toLocaleString("th-TH", { maximumFractionDigits: 4 })}%)</small><strong>{MONEY.format(bill.commission)}</strong></div>
              </div>
              <section className="winner-prize-list" aria-label="เลขและประเภทรางวัลที่ถูก">
                <h3>เลขที่ถูกรางวัล</h3>
                {bill.prizes.map((prize, index) => <div key={`${prize.itemId}:${prize.label}:${index}`}>
                  <b>{prize.number}</b>
                  <span>{prize.label}{prize.packagePrice !== null ? ` · ชุด ${MONEY.format(prize.packagePrice)} บาท × ${prize.quantity}` : ""}</span>
                  <strong>{MONEY.format(prize.payout)} บาท</strong>
                </div>)}
              </section>
            </article>)}
          </div>
        </section>)}
      </div>
      {report.pageCount > 1 && <nav className="winner-report-pagination" aria-label="เปลี่ยนหน้ารายงาน">
        {report.page > 1 ? <Link href={pageHref(report.page - 1)}>← ก่อนหน้า</Link> : <span />}
        <strong>หน้า {report.page.toLocaleString("th-TH")} / {report.pageCount.toLocaleString("th-TH")}</strong>
        {report.page < report.pageCount ? <Link href={pageHref(report.page + 1)}>ถัดไป →</Link> : <span />}
      </nav>}
    </>}
  </main>;
}

import Link from "next/link";
import {
  BET_TABS,
  drawDateLabel,
  type BetTab,
} from "@/lib/bills/betting";
import { listBetBills } from "@/lib/bills/service";
import { historyHref, type ParsedHistoryFilter } from "@/lib/bills/history-filter";
import type { Actor } from "@/lib/auth/context";
import { AgentBillFilters } from "./AgentBillFilters";
import { ThaiFlag } from "./ThaiFlag";
import { DRAW_DISPLAY_STATUS_LABEL, getDrawDisplayStatus } from "@/lib/draws/display-status";

const TAB_LABEL: Record<BetTab, string> = {
  ALL: "ทั้งหมด",
  PENDING: "กำลังแทง",
  WON: "ถูกรางวัล",
  LOST: "ไม่ถูกรางวัล",
  CANCELLED: "ยกเลิก",
};

const TAB_ICON: Record<BetTab, string> = {
  ALL: "M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 17.5l9 5 9-5",
  PENDING: "M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  WON: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
  LOST: "M15 9l-6 6M9 9l6 6M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
  CANCELLED: "M5.6 5.6l12.8 12.8M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z",
};

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Asia/Bangkok",
});

const THAI_DATE_TIME = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

export function slipDateTime(date: Date): string {
  return DATE_TIME.format(date).replace(",", "");
}

function baht(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** เลขหน้าที่แสดง: หน้าแรก หน้าสุดท้าย และรอบหน้าปัจจุบัน */
function pageNumbers(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  sorted.forEach((value, index) => {
    if (index > 0 && value - (sorted[index - 1] ?? value) > 1) result.push("gap");
    result.push(value);
  });
  return result;
}

/** หน้าประวัติรายการ ใช้ร่วมกันทุกบทบาท Agent เห็นเฉพาะบิลของตนเองผ่าน billScope */
export async function AgentBillBoard({
  actor,
  filter,
  draws,
  agents,
}: {
  actor: Actor;
  filter: ParsedHistoryFilter;
  draws: { value: string; label: string }[];
  agents: { value: string; label: string }[] | null;
}) {
  const result = await listBetBills(actor, {
    tab: filter.tab,
    lotteryType: filter.lotteryType,
    query: filter.query,
    dateFrom: filter.dateFrom,
    dateTo: filter.dateTo,
    drawId: filter.drawId || undefined,
    agentId: filter.agentId || undefined,
    page: filter.page,
    pageSize: 10,
  });
  const { bills, counts, page, pageCount, pageSize, total, totals } = result;

  const stake = Number(totals.stake);
  const payout = Number(totals.payout);
  const decided = counts.ALL;
  const share = (value: number) => (decided > 0 ? (value / decided) * 100 : 0);
  const wonShare = share(counts.WON);
  const lostShare = share(counts.LOST);
  const cancelledShare = share(counts.CANCELLED);
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  const exportHref = historyHref("/api/bills/export", { ...filter, page: 1 });

  return (
    <section className="slip-board" aria-labelledby="slip-board-heading">
      <nav className="slip-breadcrumb" aria-label="ตำแหน่งหน้า"><Link href="/">ภาพรวม</Link><span aria-hidden="true">/</span><span>ประวัติรายการ</span></nav>
      <header className="slip-board-head">
        <div>
          <h1 id="slip-board-heading">ประวัติรายการ</h1>
          <p>ค้นหา ตรวจสอบ และติดตามผลรายการย้อนหลัง</p>
        </div>
        <div className="slip-head-actions">
          <a href={exportHref} className="slip-outline-button">⇩ ส่งออก CSV</a>
          <Link href="/bills/new" className="slip-primary-button">＋ สร้างบิลใหม่</Link>
        </div>
      </header>

      <nav className="slip-tabs" aria-label="กรองตามสถานะ">
        {BET_TABS.map((item) => (
          <Link
            key={item}
            href={historyHref("/bills", filter, { tab: item === "ALL" ? "" : item, page: 1 })}
            className={`slip-tab slip-tab-${item.toLowerCase()}`}
            aria-current={item === filter.tab ? "page" : undefined}
          >
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={TAB_ICON[item]} /></svg>
            <span>{TAB_LABEL[item]}</span>
            <strong>{counts[item].toLocaleString("th-TH")}</strong>
          </Link>
        ))}
      </nav>

      <AgentBillFilters
        key={`${filter.query}|${filter.from}|${filter.to}|${filter.drawId}|${filter.agentId}`}
        query={filter.query}
        from={filter.from}
        to={filter.to}
        drawId={filter.drawId}
        agentId={filter.agentId}
        tab={filter.tab}
        draws={draws}
        agents={agents}
      />

      <div className="slip-history-layout">
        <section className="slip-panel slip-history-table" aria-labelledby="slip-history-heading">
          <header className="slip-panel-head">
            <h2 id="slip-history-heading">10 รายการล่าสุด</h2>
            <span>แสดงครั้งละไม่เกิน 10 รายการ · พบทั้งหมด {total.toLocaleString("th-TH")}</span>
          </header>
          {bills.length === 0 ? (
            <p className="slip-empty">ไม่พบรายการที่ตรงกับเงื่อนไข</p>
          ) : (
            <ol className="slip-history-cards">
              {bills.map((bill, index) => {
                const drawStatus = getDrawDisplayStatus(bill.draw);
                const payout = Number(bill.totalPayout);
                return (
                  <li key={bill.id} className="slip-history-card">
                    <header className="slip-card-head">
                      <div>
                        <span className="slip-card-rank" aria-label={`ลำดับ ${firstRow + index}`}>{firstRow + index}</span>
                        <p><small>เลขบิล</small><Link href={`/bills/${bill.id}`} className="slip-bill-number">#{bill.billNumber ?? "ร่าง"}</Link></p>
                      </div>
                      <span
                        className={`slip-status slip-draw-status-${drawStatus.toLowerCase()}`}
                        aria-label={`สถานะงวด ${DRAW_DISPLAY_STATUS_LABEL[drawStatus]}`}
                      >
                        {DRAW_DISPLAY_STATUS_LABEL[drawStatus]}
                      </span>
                    </header>
                    <div className="slip-card-identity">
                      <p><span>ชื่อลูกค้า</span><strong>{bill.title}</strong></p>
                      <p><span>ชื่อ Agent</span><strong>{bill.agent.code} · {bill.agent.name}</strong></p>
                    </div>
                    <div className="slip-card-finance">
                      <div className="slip-card-draw"><ThaiFlag /><span><small>งวด</small><strong>{drawDateLabel(bill.draw)}</strong></span></div>
                      <div><small>ยอดเดิมพัน</small><strong>{baht(Number(bill.totalStake))} บาท</strong></div>
                      <div><small>จำนวนเลข</small><strong>{bill._count.items.toLocaleString("th-TH")} รายการ</strong></div>
                      <div><small>เงินรางวัล</small><strong className={payout > 0 ? "is-won" : undefined}>{payout > 0 ? `${baht(payout)} บาท` : "—"}</strong></div>
                    </div>
                    <footer className="slip-card-footer">
                      <time dateTime={(bill.confirmedAt ?? bill.createdAt).toISOString()}>▣ {THAI_DATE_TIME.format(bill.confirmedAt ?? bill.createdAt)}</time>
                      <Link href={`/bills/${bill.id}`} className="slip-detail">ดูรายละเอียด</Link>
                    </footer>
                  </li>
                );
              })}
            </ol>
          )}
          <footer className="slip-pagination">
            <span>แสดง {firstRow.toLocaleString("th-TH")}–{lastRow.toLocaleString("th-TH")} จาก {total.toLocaleString("th-TH")} รายการ</span>
            {pageCount > 1 && (
              <nav aria-label="เลือกหน้า">
                {page > 1 ? <Link href={historyHref("/bills", filter, { page: page - 1 })} aria-label="หน้าก่อน">‹</Link> : <span aria-hidden="true">‹</span>}
                {pageNumbers(page, pageCount).map((value, index) => value === "gap"
                  ? <span key={`gap-${index}`} className="slip-page-gap">…</span>
                  : <Link key={value} href={historyHref("/bills", filter, { page: value })} aria-current={value === page ? "page" : undefined}>{value}</Link>)}
                {page < pageCount ? <Link href={historyHref("/bills", filter, { page: page + 1 })} aria-label="หน้าถัดไป">›</Link> : <span aria-hidden="true">›</span>}
              </nav>
            )}
          </footer>
        </section>

        <aside className="slip-panel slip-history-summary" aria-labelledby="slip-summary-heading">
          <header className="slip-panel-head"><h2 id="slip-summary-heading">สรุปช่วงที่เลือก</h2></header>
          <dl>
            <div><dt>ยอดเดิมพันรวม</dt><dd className="is-blue">{baht(stake)} บาท</dd></div>
            <div><dt>จำนวนรายการ</dt><dd>{counts.ALL.toLocaleString("th-TH")}</dd></div>
            <div><dt>ถูกรางวัล</dt><dd className="is-green">{counts.WON.toLocaleString("th-TH")} รายการ</dd></div>
            <div><dt>เงินรางวัลรวม</dt><dd>{baht(payout)} บาท</dd></div>
            <div><dt>อัตราถูกรางวัล</dt><dd>{wonShare.toFixed(1)}%</dd></div>
          </dl>
          <div className="slip-donut-row">
            <div
              className="slip-donut"
              role="img"
              aria-label={`ถูกรางวัล ${counts.WON} ไม่ถูกรางวัล ${counts.LOST} ยกเลิก ${counts.CANCELLED} กำลังแทง ${counts.PENDING}`}
              style={{ background: `conic-gradient(#12a35c 0 ${wonShare}%, #e2475a ${wonShare}% ${wonShare + lostShare}%, #e8941a ${wonShare + lostShare}% ${wonShare + lostShare + cancelledShare}%, #c9d8e8 ${wonShare + lostShare + cancelledShare}% 100%)` }}
            >
              <span><strong>{counts.ALL.toLocaleString("th-TH")}</strong>รายการ</span>
            </div>
            <ul>
              <li><i className="is-won" />ถูกรางวัล <strong>{counts.WON}</strong></li>
              <li><i className="is-lost" />ไม่ถูกรางวัล <strong>{counts.LOST}</strong></li>
              <li><i className="is-cancelled" />ยกเลิก <strong>{counts.CANCELLED}</strong></li>
              <li><i className="is-pending" />กำลังแทง <strong>{counts.PENDING}</strong></li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}

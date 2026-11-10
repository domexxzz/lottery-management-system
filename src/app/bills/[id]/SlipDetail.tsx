import Link from "next/link";
import type { Prisma } from "@prisma/client";
import type { ReactNode } from "react";
import {
  BET_STATUS_LABEL,
  betStatusOf,
  compactRate,
  drawDateLabel,
  itemBetStatus,
  lotteryLabel,
  type BetStatus,
} from "@/lib/bills/betting";
import { ThaiFlag } from "../ThaiFlag";
import { SlipItems, type SlipItemRow } from "./SlipItems";

type SlipItem = {
  id: string;
  number: string;
  stake: Prisma.Decimal;
  payout: Prisma.Decimal;
  isWinner: boolean;
  payoutRateSnapshot: Prisma.Decimal;
  prizeType: { name: string };
};

type SlipBill = {
  id: string;
  drawId: string;
  billNumber: string | null;
  drawSequence: number | null;
  title: string;
  status: "DRAFT" | "CONFIRMED" | "LOCKED" | "SETTLED" | "CANCELLED";
  totalStake: Prisma.Decimal;
  totalPayout: Prisma.Decimal;
  createdAt: Date;
  confirmedAt: Date | null;
  createdBy: { displayName: string };
  agent: { code: string; name: string };
  draw: { name: string; drawDate: Date | null; lotteryType: string; cutoffAt: Date; status: string };
  items: SlipItem[];
};

const THAI_DATE_TIME = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

function baht(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function signed(value: number): string {
  const text = baht(Math.abs(value));
  return value > 0 ? `+${text}` : value < 0 ? `-${text}` : text;
}

/** ผลได้เสียของลูกค้าต่อรายการ: ถูกได้ยอดจ่ายเต็ม (เดิมพัน × อัตราจ่าย) ไม่ถูกเสียเงินแทง */
function profitOf(status: BetStatus, item: SlipItem): number | null {
  if (status === "WON") return Number(item.payout);
  if (status === "LOST") return -Number(item.stake);
  if (status === "CANCELLED") return 0;
  return null;
}

export function SlipDetail({ bill, settledAt, showDrawLink, beforeItems }: { bill: SlipBill; settledAt: Date | null; showDrawLink: boolean; beforeItems?: ReactNode }) {
  const rows: SlipItemRow[] = bill.items.map((item, index) => {
    const status = itemBetStatus(bill.status, item.isWinner);
    return {
      id: item.id,
      order: index + 1,
      number: item.number,
      prizeTypeName: item.prizeType.name,
      stake: Number(item.stake),
      rate: bill.status === "DRAFT" ? null : compactRate(item.payoutRateSnapshot),
      status,
      statusLabel: BET_STATUS_LABEL[status],
      prize: status === "WON" ? Number(item.payout) : status === "LOST" || status === "CANCELLED" ? 0 : null,
    };
  });

  const sum = (statuses: BetStatus[], pick: (row: SlipItemRow, item: SlipItem) => number) => {
    let count = 0;
    let amount = 0;
    rows.forEach((row, index) => {
      if (!statuses.includes(row.status)) return;
      count += 1;
      amount += pick(row, bill.items[index] as SlipItem);
    });
    return { count, amount };
  };
  const pending = sum(["PENDING", "DRAFT"], (row) => row.stake);
  const won = sum(["WON"], (_row, item) => Number(item.payout));
  const lost = sum(["LOST"], (row) => row.stake);
  const cancelled = sum(["CANCELLED"], (row) => row.stake);

  const billStatus = betStatusOf(bill);
  const stakeTotal = Number(bill.totalStake);
  const payoutTotal = Number(bill.totalPayout);
  // ผลสุทธิ (สรุปด้านข้าง) = ถูก + ยอดจ่ายเต็ม, ไม่ถูก − เงินแทง
  const net = billStatus === "WON" || billStatus === "LOST" || billStatus === "CANCELLED"
    ? rows.reduce((total, row, index) => total + (profitOf(row.status, bill.items[index] as SlipItem) ?? 0), 0)
    : null;
  // ผลได้เสีย = ยอดจ่ายรางวัลเต็มของรายการที่ถูก ไม่หักเงินแทง
  const prizeTotal = net === null ? null : rows.reduce((total, row) => total + (row.prize ?? 0), 0);
  const settled = bill.status === "SETTLED";
  const closed = bill.status === "LOCKED" || settled;
  const returnRate = stakeTotal > 0 ? (payoutTotal / stakeTotal) * 100 : 0;

  const steps = [
    { label: "สร้างบิล", done: true, at: THAI_DATE_TIME.format(bill.createdAt) },
    { label: "ยืนยันบิล", done: bill.confirmedAt !== null, at: bill.confirmedAt ? THAI_DATE_TIME.format(bill.confirmedAt) : "รอยืนยัน" },
    { label: "ปิดรับ", done: closed, at: closed ? THAI_DATE_TIME.format(bill.draw.cutoffAt) : `ปิด ${THAI_DATE_TIME.format(bill.draw.cutoffAt)}` },
    { label: "ตรวจรางวัล", done: settled, at: settled && settledAt ? THAI_DATE_TIME.format(settledAt) : settled ? "ตรวจแล้ว" : "รอผลรางวัล" },
  ];

  return (
    <div className="slip-detail-board" id="bill-items">
      <section className="slip-panel slip-detail-hero" aria-label="ข้อมูลบิล">
        <div className="slip-detail-facts">
          <div className="slip-fact">
            <small>เลขบิล</small>
            <strong className="slip-fact-number">{bill.drawSequence === null ? "บิลร่าง" : `บิล ${bill.drawSequence}`}</strong>
            <span>ลูกค้า: <b>{bill.title}</b></span>
          </div>
          <div className="slip-fact">
            <small>งวด</small>
            <strong><ThaiFlag /> {lotteryLabel(bill.draw.lotteryType)} {drawDateLabel(bill.draw)}</strong>
            <span>Agent: {bill.agent.code} · {bill.agent.name}</span>
            <span>สร้างโดย {bill.createdBy.displayName}</span>
          </div>
          <div className="slip-fact-money">
            <div><small>ยอดเดิมพันรวม</small><strong className="is-blue">{baht(stakeTotal)} <span>บาท</span></strong></div>
            <div><small>ผลได้เสีย</small><strong className={prizeTotal !== null && prizeTotal > 0 ? "is-plus" : ""}>{prizeTotal === null ? "รอผล" : <>{baht(prizeTotal)} <span>บาท</span></>}</strong></div>
          </div>
        </div>
        <ol className="slip-timeline" aria-label="ลำดับสถานะบิล">
          {steps.map((step, index) => (
            <li key={step.label} className={step.done ? "is-done" : ""}>
              <span aria-hidden="true">{step.done ? "✓" : index + 1}</span>
              <div><strong>{step.label}</strong><small>{step.at}</small></div>
            </li>
          ))}
        </ol>
      </section>

      <div className="slip-summary-stats">
        <div className="is-pending"><span>กำลังแทง</span><strong>{pending.count} รายการ</strong><small>{baht(pending.amount)} บาท</small></div>
        <div className="is-won"><span>ถูกรางวัล</span><strong>{won.count} รายการ</strong><small>{baht(won.amount)} บาท</small></div>
        <div className="is-lost"><span>ไม่ถูกรางวัล</span><strong>{lost.count} รายการ</strong><small>{baht(lost.amount)} บาท</small></div>
        <div className="is-cancelled"><span>ยกเลิก</span><strong>{cancelled.count} รายการ</strong><small>{baht(cancelled.amount)} บาท</small></div>
      </div>

      {beforeItems}

      <div className="slip-detail-content">
        <SlipItems rows={rows} totalStake={stakeTotal} prizeTotal={prizeTotal} />

        <aside className="slip-panel slip-result-summary" aria-labelledby="slip-result-heading">
          <header className="slip-panel-head"><h2 id="slip-result-heading">สรุปผลบิล</h2></header>
          <div className="slip-result-body">
            <div className={`slip-result-orb is-${billStatus.toLowerCase()}`}>
              <span aria-hidden="true">{billStatus === "WON" ? "✓" : billStatus === "LOST" ? "×" : billStatus === "CANCELLED" ? "⊘" : "…"}</span>
              <strong>{BET_STATUS_LABEL[billStatus]}</strong>
            </div>
            <dl>
              <div><dt>ยอดเดิมพัน</dt><dd className="is-blue">{baht(stakeTotal)}</dd></div>
              <div><dt>เงินรางวัล</dt><dd>{baht(payoutTotal)}</dd></div>
              <div><dt>ผลสุทธิ</dt><dd className={net === null ? "" : net > 0 ? "is-plus" : net < 0 ? "is-minus" : ""}>{net === null ? "รอผล" : signed(net)}</dd></div>
              <div><dt>อัตราคืนทุน</dt><dd>{returnRate.toFixed(1)}%</dd></div>
            </dl>
          </div>
          <p className="slip-result-note">{settled ? "ผลรางวัลได้รับการตรวจสอบและบันทึกแล้ว" : "ระบบจะแสดงผลหลังประกาศผลรางวัล"}</p>
          {showDrawLink && <Link href={`/draws/${bill.drawId}`} className="slip-outline-button slip-result-link">ดูผลรางวัลงวดนี้</Link>}
        </aside>
      </div>
    </div>
  );
}

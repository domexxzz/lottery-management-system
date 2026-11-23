import type { Prisma } from "@prisma/client";
import { BET_STATUS_LABEL, compactRate, drawDateLabel, itemBetStatus, lotteryLabel, type BetStatus } from "@/lib/bills/betting";
import { LotteryFlag } from "../ThaiFlag";
import { SlipItems, type SlipItemRow } from "./SlipItems";
import { laoSetPackageLabel } from "@/lib/lao/rules";

type SlipPart = {
  id: string;
  drawSequence: number | null;
  title: string;
  status: "DRAFT" | "CONFIRMED" | "LOCKED" | "SETTLED" | "CANCELLED";
  totalStake: Prisma.Decimal;
  totalPayout: Prisma.Decimal;
  agent: { code: string; name: string };
  draw: { name: string; drawDate: Date | null; lotteryType: string; officialNumber: string | null };
  items: Array<{
    id: string;
    number: string;
    stake: Prisma.Decimal;
    packagePrice: Prisma.Decimal | null;
    quantity: number;
    payout: Prisma.Decimal;
    isWinner: boolean;
    payoutRateSnapshot: Prisma.Decimal;
    prizeType: { name: string; digits: number };
    winningPrizes: Array<{ id: string; prizeLabelSnapshot: string; payoutRateSnapshot: Prisma.Decimal; payout: Prisma.Decimal; isPaid: boolean }>;
  }>;
};

function baht(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** มุมมองเริ่มต้นของบิลหลายหวย: รวมรายการทุกส่วนไว้หน้าเดียว แต่ยังคงชื่อหวยกำกับทุกรายการ */
export function SlipAllDetail({ parts, manageableBillIds = [] }: { parts: SlipPart[]; manageableBillIds?: string[] }) {
  let order = 0;
  const rows: SlipItemRow[] = parts.flatMap((part) => part.items.map((item) => {
    order += 1;
    const status = itemBetStatus(part.status, item.isWinner);
    const winningPrizes = item.winningPrizes.map((prize) => ({
      id: prize.id,
      label: prize.prizeLabelSnapshot,
      rate: Number(prize.payoutRateSnapshot),
      payout: Number(prize.payout),
      isPaid: prize.isPaid,
    }));
    return {
      id: item.id,
      billId: part.id,
      order,
      number: item.number,
      lotteryType: part.draw.lotteryType,
      lotteryLabel: part.draw.lotteryType === "THAI_GOVERNMENT" ? "หวยไทย" : lotteryLabel(part.draw.lotteryType),
      prizeTypeName: item.prizeType.name,
      packageLabel: part.draw.lotteryType === "LAO_SET" ? laoSetPackageLabel(item.packagePrice ?? item.stake) : null,
      quantity: item.quantity,
      unitStake: Number(item.packagePrice ?? item.stake),
      digits: item.prizeType.digits,
      canManage: manageableBillIds.includes(part.id),
      stake: Number(item.stake),
      rate: part.status === "DRAFT" ? null : compactRate(item.payoutRateSnapshot),
      rateText: part.draw.lotteryType === "LAO_SET"
        ? winningPrizes.length > 0
          ? `ตรวจพบ ${winningPrizes.length} รางวัล · จ่ายสูงสุด 1 รางวัล`
          : "ตามตาราง 8 รางวัล"
        : part.status === "DRAFT" ? "—" : `${compactRate(item.payoutRateSnapshot)} เท่า`,
      status,
      statusLabel: BET_STATUS_LABEL[status],
      winningPrizes,
      prize: status === "WON" ? Number(item.payout) : status === "LOST" || status === "CANCELLED" ? 0 : null,
    };
  }));
  const activeParts = parts.filter((part) => part.status !== "CANCELLED");
  const totalStake = activeParts.reduce((sum, part) => sum + Number(part.totalStake), 0);
  const totalPayout = activeParts.reduce((sum, part) => sum + Number(part.totalPayout), 0);
  const waiting = rows.some((row) => row.status === "DRAFT" || row.status === "PENDING");
  const prizeTotal = waiting ? null : rows.reduce((sum, row) => sum + (row.prize ?? 0), 0);
  const statusSummary = (statuses: BetStatus[]) => {
    const selected = rows.filter((row) => statuses.includes(row.status));
    return { count: selected.length, amount: selected.reduce((sum, row) => sum + (row.status === "WON" ? row.prize ?? 0 : row.stake), 0) };
  };
  const pending = statusSummary(["DRAFT", "PENDING"]);
  const won = statusSummary(["WON"]);
  const lost = statusSummary(["LOST"]);
  const cancelled = statusSummary(["CANCELLED"]);
  const first = parts[0];

  return (
    <div className="slip-detail-board" id="bill-items">
      <section className="slip-panel slip-all-overview" aria-labelledby="slip-all-heading">
        <header className="slip-panel-head">
          <h2 id="slip-all-heading">รายละเอียดรวมทั้งบิล</h2>
          <span>{parts.length} ประเภทหวย</span>
        </header>
        <div className="slip-all-facts">
          <div><small>เลขบิล</small><strong>{first?.drawSequence === null ? "บิลร่าง" : `บิล ${first?.drawSequence ?? "-"}`}</strong><span>ลูกค้า: {first?.title ?? "-"}</span></div>
          <div><small>Agent</small><strong>{first?.agent.code ?? "-"}</strong><span>{first?.agent.name ?? "-"}</span></div>
          <div><small>ยอดเดิมพันรวม</small><strong className="is-blue">{baht(totalStake)} บาท</strong><span>{rows.length} รายการ</span></div>
          <div><small>เงินรางวัลรวม</small><strong>{waiting ? "รอผล" : `${baht(totalPayout)} บาท`}</strong><span>{waiting ? "ยังมีงวดรอผลรางวัล" : "ตรวจครบทุกงวดแล้ว"}</span></div>
        </div>
        <div className="slip-all-draws">
          {parts.map((part) => (
            <span key={part.id} className={`is-${part.draw.lotteryType.toLowerCase()}`}>
              <LotteryFlag lotteryType={part.draw.lotteryType} />
              <b>{lotteryLabel(part.draw.lotteryType)}</b>
              <small>งวด {drawDateLabel(part.draw)} · {part.items.length} รายการ</small>
            </span>
          ))}
        </div>
      </section>

      <div className="slip-summary-stats">
        <div className="is-pending"><span>กำลังแทง</span><strong>{pending.count} รายการ</strong><small>{baht(pending.amount)} บาท</small></div>
        <div className="is-won"><span>ถูกรางวัล</span><strong>{won.count} รายการ</strong><small>{baht(won.amount)} บาท</small></div>
        <div className="is-lost"><span>ไม่ถูกรางวัล</span><strong>{lost.count} รายการ</strong><small>{baht(lost.amount)} บาท</small></div>
        <div className="is-cancelled"><span>ลบแล้ว</span><strong>{cancelled.count} รายการ</strong><small>{baht(cancelled.amount)} บาท</small></div>
      </div>

      <SlipItems rows={rows} totalStake={totalStake} prizeTotal={prizeTotal} heading="รายการเลขทั้งหมดในบิล" />
    </div>
  );
}

import type { AccountingTotals } from "./accounting";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** รวมยอดของหลายช่วงแบบ A + B สำหรับกล่องสรุป โดยไม่เปลี่ยนสูตรของแต่ละช่วง */
export function combineAccountingTotals(...items: readonly AccountingTotals[]): AccountingTotals {
  const sum = (pick: (item: AccountingTotals) => number) => round2(items.reduce((total, item) => total + pick(item), 0));
  return {
    draws: sum((item) => item.draws),
    settledDraws: sum((item) => item.settledDraws),
    bills: sum((item) => item.bills),
    winners: sum((item) => item.winners),
    gross: sum((item) => item.gross),
    commission: sum((item) => item.commission),
    net: sum((item) => item.net),
    payout: sum((item) => item.payout),
    profit: sum((item) => item.profit),
    settledGross: sum((item) => item.settledGross),
    settledCommission: sum((item) => item.settledCommission),
    pendingGross: sum((item) => item.pendingGross),
  };
}

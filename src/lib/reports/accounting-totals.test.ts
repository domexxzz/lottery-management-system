import { describe, expect, test } from "vitest";
import type { AccountingTotals } from "./accounting";
import { combineAccountingTotals } from "./accounting-totals";

const totals = (gross: number, payout: number, commission: number): AccountingTotals => ({
  draws: 1, settledDraws: 1, bills: 2, winners: 1,
  gross, payout, commission, net: gross - commission, profit: gross - payout - commission,
  settledGross: gross, settledCommission: commission, pendingGross: 0,
});

describe("ยอดรวมช่วง A และ B", () => {
  test("รวมทุกตัวเลขโดยรักษาสมการกำไรเดิม", () => {
    const combined = combineAccountingTotals(totals(1000, 100, 200), totals(500, 50, 100));
    expect(combined).toMatchObject({ draws: 2, bills: 4, gross: 1500, payout: 150, commission: 300, net: 1200, profit: 1050 });
    expect(combined.profit).toBe(combined.settledGross - combined.payout - combined.settledCommission);
  });
});

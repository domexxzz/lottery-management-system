import { describe, expect, test } from "vitest";
import { aggregateAgentCustomers } from "./customer-aggregation";

describe("aggregateAgentCustomers", () => {
  test("รวมลูกค้าชื่อเดียวกันและเรียงตามยอดซื้อจริง", () => {
    const rows = aggregateAgentCustomers([
      { title: "สมชาย", totalStake: 100, totalPayout: 0, createdAt: new Date("2026-11-01T00:00:00Z") },
      { title: " สมชาย ", totalStake: 50, totalPayout: 20, createdAt: new Date("2026-11-02T00:00:00Z") },
      { title: "สมหญิง", totalStake: 200, totalPayout: 0, createdAt: new Date("2026-11-03T00:00:00Z") },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "สมหญิง", gross: 200, billCount: 1 });
    expect(rows[1]).toMatchObject({ name: "สมชาย", gross: 150, payout: 20, billCount: 2 });
    expect(rows[1]?.lastBillAt.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });
});

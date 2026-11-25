import { describe, expect, it } from "vitest";
import { resolveCommissionPeriod } from "./commission-period";

describe("resolveCommissionPeriod", () => {
  it("accepts an unambiguous Bangkok calendar day", () => {
    expect(resolveCommissionPeriod({ period: "day", date: "2026-11-23" })).toMatchObject({ mode: "range", from: "2026-11-23", to: "2026-11-23" });
  });

  it("accepts a start and end date range", () => {
    expect(resolveCommissionPeriod({ period: "range", dateFrom: "2026-11-01", dateTo: "2026-11-23" }))
      .toMatchObject({ mode: "range", from: "2026-11-01", to: "2026-11-23" });
  });

  it("accepts a calendar month", () => {
    expect(resolveCommissionPeriod({ period: "month", date: "2026-11" })).toMatchObject({ mode: "month", value: "2026-11" });
  });

  it.each([
    { period: "day", date: "2026-02-30" },
    { period: "range", dateFrom: "2026-11-23", dateTo: "2026-11-01" },
    { period: "month", date: "2026-13" },
    { period: "week", date: "2026-11-23" },
  ])("falls back to all days for invalid input: $period/$date", (query) => {
    expect(resolveCommissionPeriod(query)).toEqual({ mode: "all", label: "ทุกวัน" });
  });
});

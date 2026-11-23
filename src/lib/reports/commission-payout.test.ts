import { describe, expect, it } from "vitest";
import { resolveCommissionPeriod } from "./commission-period";

describe("resolveCommissionPeriod", () => {
  it("accepts an unambiguous Bangkok calendar day", () => {
    expect(resolveCommissionPeriod({ period: "day", date: "2026-11-23" })).toMatchObject({ mode: "day", value: "2026-11-23" });
  });

  it("accepts a calendar month", () => {
    expect(resolveCommissionPeriod({ period: "month", date: "2026-11" })).toMatchObject({ mode: "month", value: "2026-11" });
  });

  it.each([
    { period: "day", date: "2026-02-30" },
    { period: "month", date: "2026-13" },
    { period: "week", date: "2026-11-23" },
  ])("falls back to all days for invalid input: $period/$date", (query) => {
    expect(resolveCommissionPeriod(query)).toEqual({ mode: "all", label: "ทุกวัน" });
  });
});

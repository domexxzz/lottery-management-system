import { describe, expect, it } from "vitest";
import { nextOfficialDrawDate, officialDrawName } from "./schedule";

describe("official draw schedule", () => {
  it("keeps the first and sixteenth as official draw dates", () => {
    expect(nextOfficialDrawDate("2026-11-01T09:00")?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nextOfficialDrawDate("2026-11-16T09:00")?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("moves dates after the first through the sixteenth to the sixteenth", () => {
    expect(nextOfficialDrawDate("2026-11-02T09:00")?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(nextOfficialDrawDate("2026-11-15T23:59")?.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("moves dates after the sixteenth to the first of the next month", () => {
    expect(nextOfficialDrawDate("2026-11-17T00:00")?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(nextOfficialDrawDate("2026-12-31T23:59")?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("formats the locked draw name in Thai", () => {
    expect(officialDrawName("2026-11-07T12:00")).toBe("16 พฤศจิกายน 2569");
    expect(officialDrawName("invalid")).toBeNull();
  });
});

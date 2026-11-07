import { describe, expect, it } from "vitest";
import {
  currentMonthOfficialDrawDates,
  nextOfficialDrawDate,
  defaultOfficialDrawWindow,
  officialDrawCutoffAt,
  officialDrawName,
  parseBangkokDateTimeLocal,
  recentOfficialDrawDates,
  recommendedOfficialDrawDate,
  toBangkokDateTimeLocal,
  upcomingOfficialDrawDates,
} from "./schedule";

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

  it("sets the official cutoff to 15:00 Bangkok only for the first and sixteenth", () => {
    expect(officialDrawCutoffAt("2026-11-01")?.toISOString()).toBe("2026-11-01T08:00:00.000Z");
    expect(officialDrawCutoffAt("2026-11-16")?.toISOString()).toBe("2026-11-16T08:00:00.000Z");
    expect(officialDrawCutoffAt("2026-11-15")).toBeNull();
  });

  it("offers only future official draw dates", () => {
    expect(upcomingOfficialDrawDates(new Date("2026-11-08T00:00:00.000Z"), 4)).toEqual([
      "2026-11-16",
      "2026-12-01",
      "2026-12-16",
      "2027-01-01",
    ]);
  });

  it("lists past official dates from newest to oldest", () => {
    expect(recentOfficialDrawDates(new Date("2026-11-08T00:00:00.000Z"), 4)).toEqual([
      "2026-11-01",
      "2026-10-16",
      "2026-10-01",
      "2026-09-16",
    ]);
    expect(recentOfficialDrawDates(new Date("2026-11-16T00:00:00.000Z"), 3)).toEqual([
      "2026-11-16",
      "2026-11-01",
      "2026-10-16",
    ]);
  });

  it("recommends the sixteenth before it and the first after it", () => {
    expect(recommendedOfficialDrawDate(new Date("2026-11-08T00:00:00.000Z"))).toBe("2026-11-16");
    expect(recommendedOfficialDrawDate(new Date("2026-11-16T00:00:00.000Z"))).toBe("2026-12-01");
    expect(recommendedOfficialDrawDate(new Date("2026-11-25T00:00:00.000Z"))).toBe("2026-12-01");
  });

  it("includes both official dates from the current Bangkok month", () => {
    expect(currentMonthOfficialDrawDates(new Date("2026-11-08T00:00:00.000Z"))).toEqual([
      "2026-11-01",
      "2026-11-16",
    ]);
    expect(currentMonthOfficialDrawDates(new Date("2026-11-30T18:00:00.000Z"))).toEqual([
      "2026-12-01",
      "2026-12-16",
    ]);
  });

  it("converts editable local times using the Bangkok timezone", () => {
    expect(parseBangkokDateTimeLocal("2026-11-16T15:00")?.toISOString()).toBe("2026-11-16T08:00:00.000Z");
    expect(toBangkokDateTimeLocal(new Date("2026-11-16T08:00:00.000Z"))).toBe("2026-11-16T15:00");
    expect(parseBangkokDateTimeLocal("2026-02-30T15:00")).toBeNull();
  });

  it("defaults to opening five days before and closing one day before at 14:00 Bangkok", () => {
    const window = defaultOfficialDrawWindow("2026-11-16");
    expect(window && toBangkokDateTimeLocal(window.opensAt)).toBe("2026-11-11T00:00");
    expect(window && toBangkokDateTimeLocal(window.cutoffAt)).toBe("2026-11-15T14:00");

    const first = defaultOfficialDrawWindow("2026-12-01");
    expect(first && toBangkokDateTimeLocal(first.opensAt)).toBe("2026-11-26T00:00");
    expect(first && toBangkokDateTimeLocal(first.cutoffAt)).toBe("2026-11-30T14:00");
  });
});

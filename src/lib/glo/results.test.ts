import { describe, expect, it } from "vitest";
import { bangkokDate, buildGloPrizeSuggestions, parseGloDrawResult } from "./results";

const payload = {
  status: true,
  response: {
    result: {
      date: "2024-03-01",
      data: {
        first: { number: [{ value: "053603" }] },
        last2: { number: [{ value: "09" }] },
        last3f: { number: [{ value: "975" }, { value: "900" }] },
        last3b: { number: [{ value: "382" }, { value: "703" }] },
      },
    },
  },
};

describe("GLO result adapter", () => {
  it("keeps leading zeroes and official reference numbers", () => {
    expect(parseGloDrawResult(payload, "2024-03-01")).toEqual({
      drawDate: "2024-03-01",
      firstPrize: "053603",
      last2: "09",
      front3: ["975", "900"],
      back3: ["382", "703"],
    });
  });

  it("maps the first prize and last-two result to all 16 Rulebook codes", () => {
    const suggestions = buildGloPrizeSuggestions(parseGloDrawResult(payload, "2024-03-01"));
    expect(suggestions[1]?.value).toBe("603");
    expect(suggestions[3]?.value).toBe("053");
    expect(suggestions[5]?.value).toBe("03");
    expect(suggestions[6]?.value).toBe("09");
    expect(suggestions[12]?.value).toBe("3603");
    expect(suggestions[14]?.value).toBe("53603");
    expect(suggestions[15]?.value).toBe("053603");
    expect(Object.keys(suggestions)).toHaveLength(16);
  });

  it("rejects a response for a different draw date", () => {
    expect(() => parseGloDrawResult(payload, "2024-03-16")).toThrow(/ไม่ตรงกับวันที่รอบ/);
  });

  it("derives the calendar date in Bangkok", () => {
    expect(bangkokDate(new Date("2024-02-29T18:00:00.000Z"))).toBe("2024-03-01");
  });
});

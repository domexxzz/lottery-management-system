import { describe, expect, it } from "vitest";
import {
  bangkokDate,
  buildGloPrizeSuggestions,
  parseGloDrawResult,
} from "./results";

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

  it("maps the first prize and last-two result to every derivable Rulebook code", () => {
    const suggestions = buildGloPrizeSuggestions(parseGloDrawResult(payload, "2024-03-01"));
    expect(suggestions[1]?.values).toEqual(["603"]);
    expect(suggestions[3]?.values).toEqual(["975", "900"]);
    expect(suggestions[4]?.values).toEqual(["382", "703"]);
    expect(suggestions[5]?.values).toEqual(["03"]);
    expect(suggestions[6]?.values).toEqual(["09"]);
    expect(suggestions[12]?.values).toEqual(["3603"]);
    expect(suggestions[14]?.values).toEqual(["53603"]);
    expect(suggestions[15]?.values).toEqual(["053603"]);
    expect(Object.keys(suggestions).map(Number).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  it("uses both separately drawn front-three and back-three numbers", () => {
    const official = parseGloDrawResult(payload, "2024-03-01");
    const suggestions = buildGloPrizeSuggestions(official);
    expect(suggestions[3]).toEqual({ values: ["975", "900"], source: "เลขหน้า 3 ตัวทางการทั้ง 2 เลข" });
    expect(suggestions[4]).toEqual({ values: ["382", "703"], source: "เลขท้าย 3 ตัวทางการทั้ง 2 เลข" });
  });

  it("rejects a response for a different draw date", () => {
    expect(() => parseGloDrawResult(payload, "2024-03-16")).toThrow(/ไม่ตรงกับวันที่งวด/);
  });

  it("derives the calendar date in Bangkok", () => {
    expect(bangkokDate(new Date("2024-02-29T18:00:00.000Z"))).toBe("2024-03-01");
  });
});

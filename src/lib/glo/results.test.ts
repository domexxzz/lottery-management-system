import { describe, expect, it } from "vitest";
import {
  MANUAL_PRIZE_CODES,
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
    expect(suggestions[1]?.value).toBe("603");
    expect(suggestions[5]?.value).toBe("03");
    expect(suggestions[6]?.value).toBe("09");
    expect(suggestions[12]?.value).toBe("3603");
    expect(suggestions[14]?.value).toBe("53603");
    expect(suggestions[15]?.value).toBe("053603");
    expect(Object.keys(suggestions).map(Number).sort((a, b) => a - b)).toEqual([
      1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ]);
  });

  /*
   * เลขหน้า/เลขท้าย 3 ตัว GLO จับแยกจากรางวัลที่ 1 และจับรางวัลละ 2 เลข
   * ถ้าเดาจากรางวัลที่ 1 จะได้ 053 กับ 603 ซึ่งไม่ใช่ผลจริง (975/900 กับ 382/703)
   * และรางวัลที่ 4 จะซ้ำกับรางวัลที่ 1 พอดี อัตราจ่าย 450 เท่าจึงจ่ายผิดคนทั้งสองทาง
   * จึงต้องไม่เสนอ ปล่อยให้คนกรอกเองจากเลขทางการที่หน้าจอแสดงไว้
   */
  it("never suggests the separately drawn front-three and back-three prizes", () => {
    const official = parseGloDrawResult(payload, "2024-03-01");
    const suggestions = buildGloPrizeSuggestions(official);

    for (const code of MANUAL_PRIZE_CODES) {
      expect(suggestions[code]).toBeUndefined();
    }

    // กันการกลับไปเดาจากรางวัลที่ 1: ค่าที่เคยเสนอต้องไม่โผล่มาในรูปอื่น
    const values = Object.values(suggestions).map((item) => item.value);
    expect(values).not.toContain("053");
    expect(official.front3).not.toContain("053");
    expect(official.back3).not.toContain("603");
  });

  it("rejects a response for a different draw date", () => {
    expect(() => parseGloDrawResult(payload, "2024-03-16")).toThrow(/ไม่ตรงกับวันที่รอบ/);
  });

  it("derives the calendar date in Bangkok", () => {
    expect(bangkokDate(new Date("2024-02-29T18:00:00.000Z"))).toBe("2024-03-01");
  });
});

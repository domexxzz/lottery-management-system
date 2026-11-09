import { describe, expect, test } from "vitest";
import {
  addEntries,
  betStatusOf,
  buildEntries,
  compactRate,
  drawDateLabel,
  groupPrizeTypes,
  itemBetStatus,
  permutations,
  readBetTab,
  type BetPrizeType,
} from "./betting";

const top3: BetPrizeType = { id: "p1", code: 1, name: "3 ตัวบน", digits: 3, matchRule: "EXACT", payoutRate: "900" };
const tod3: BetPrizeType = { id: "p2", code: 2, name: "3 ตัวโต๊ด", digits: 3, matchRule: "PERMUTATION", payoutRate: "150" };
const top2: BetPrizeType = { id: "p5", code: 5, name: "2 ตัวบน", digits: 2, matchRule: "EXACT", payoutRate: "90" };
const runTop: BetPrizeType = { id: "p8", code: 8, name: "วิ่งบน", digits: 1, matchRule: "CONTAINS_DIGIT", payoutRate: "3.2" };
const top4: BetPrizeType = { id: "p12", code: 12, name: "4 ตัวบน", digits: 4, matchRule: "EXACT", payoutRate: "6000" };
const rules = new Map([top3, tod3, top2, runTop, top4].map((rule) => [rule.id, rule]));

describe("permutations", () => {
  test("เลข 3 หลักไม่ซ้ำได้ 6 แบบ ตามลำดับในโพยตัวอย่าง", () => {
    expect(permutations("483")).toEqual(["483", "438", "843", "834", "348", "384"]);
  });

  test("เลขที่มีหลักซ้ำได้ 3 แบบ และเลขซ้ำทั้งหมดได้แบบเดียว", () => {
    expect(permutations("112")).toEqual(["112", "121", "211"]);
    expect(permutations("777")).toEqual(["777"]);
    expect(permutations("12")).toEqual(["12", "21"]);
  });
});

describe("buildEntries", () => {
  test("สร้างรายการตามทุกตัวเลือกที่เลือก", () => {
    const entries = buildEntries({ numberValue: "483", stake: 50, selected: [top3, tod3], reverse: false });
    expect(entries).toEqual([
      { prizeTypeId: "p1", number: "483", stake: 50 },
      { prizeTypeId: "p2", number: "483", stake: 50 },
    ]);
  });

  test("โหมดสลับแตกเลขเฉพาะรางวัลตรงตัว ไม่แตกรางวัลโต๊ด", () => {
    const entries = buildEntries({ numberValue: "483", stake: 50, selected: [top3, tod3], reverse: true });
    expect(entries.filter((entry) => entry.prizeTypeId === "p1")).toHaveLength(6);
    expect(entries.filter((entry) => entry.prizeTypeId === "p2")).toHaveLength(1);
  });

  test("ข้ามตัวเลือกที่จำนวนหลักไม่ตรงกับเลขที่กด", () => {
    expect(buildEntries({ numberValue: "48", stake: 10, selected: [top3, top2], reverse: false })).toEqual([
      { prizeTypeId: "p5", number: "48", stake: 10 },
    ]);
  });
});

describe("addEntries", () => {
  test("เลขกับประเภทเดียวกันรวมยอดแทนการเพิ่มแถวซ้ำ", () => {
    const first = addEntries([], [{ prizeTypeId: "p1", number: "483", stake: 50 }], rules);
    const second = addEntries(first, [{ prizeTypeId: "p1", number: "483", stake: 20 }], rules);
    expect(second).toEqual([{ prizeTypeId: "p1", number: "483", stake: 70 }]);
  });

  test("รางวัลโต๊ดถือว่าเลขสลับหลักเป็นเลขเดียวกัน", () => {
    const merged = addEntries(
      [{ prizeTypeId: "p2", number: "483", stake: 10 }],
      [{ prizeTypeId: "p2", number: "348", stake: 5 }],
      rules,
    );
    expect(merged).toEqual([{ prizeTypeId: "p2", number: "483", stake: 15 }]);
  });

  test("ไม่แก้ไขอาร์เรย์เดิม", () => {
    const current = [{ prizeTypeId: "p1", number: "111", stake: 10 }];
    addEntries(current, [{ prizeTypeId: "p1", number: "111", stake: 10 }], rules);
    expect(current[0]?.stake).toBe(10);
  });
});

describe("groupPrizeTypes", () => {
  test("เรียงแท็บเป็น 2 ตัว, 3 ตัว, เลขวิ่ง, 4 ตัว", () => {
    const groups = groupPrizeTypes([top4, runTop, tod3, top3, top2]);
    expect(groups.map((group) => group.label)).toEqual(["2 ตัว", "3 ตัว", "เลขวิ่ง", "4 ตัว"]);
    expect(groups[1]?.prizeTypes.map((prizeType) => prizeType.id)).toEqual(["p1", "p2"]);
    expect(groups[2]?.digits).toBe(1);
  });
});

describe("สถานะโพย", () => {
  test("แปลงสถานะบิลเป็นสถานะที่ Agent เห็น", () => {
    expect(betStatusOf({ status: "CONFIRMED", totalPayout: 0 })).toBe("PENDING");
    expect(betStatusOf({ status: "LOCKED", totalPayout: 0 })).toBe("PENDING");
    expect(betStatusOf({ status: "SETTLED", totalPayout: "900.00" })).toBe("WON");
    expect(betStatusOf({ status: "SETTLED", totalPayout: "0.00" })).toBe("LOST");
    expect(betStatusOf({ status: "CANCELLED", totalPayout: 0 })).toBe("CANCELLED");
  });

  test("สถานะรายเลข", () => {
    expect(itemBetStatus("SETTLED", true)).toBe("WON");
    expect(itemBetStatus("SETTLED", false)).toBe("LOST");
    expect(itemBetStatus("CONFIRMED", false)).toBe("PENDING");
    expect(itemBetStatus("CANCELLED", true)).toBe("CANCELLED");
  });

  test("แท็บที่ไม่รู้จักกลับเป็นทั้งหมด", () => {
    expect(readBetTab("WON")).toBe("WON");
    expect(readBetTab("nope")).toBe("ALL");
    expect(readBetTab(undefined)).toBe("ALL");
  });
});

describe("การแสดงผล", () => {
  test("วันที่งวดและชื่องวดสำรอง", () => {
    expect(drawDateLabel({ drawDate: new Date(Date.UTC(2026, 10, 1)), name: "x" })).toBe("01/11/2026");
    expect(drawDateLabel({ drawDate: null, name: "งวดตัวอย่าง 1" })).toBe("ตัวอย่าง 1");
    expect(drawDateLabel({ drawDate: null, name: "30 พฤศจิกายน 2569" })).toBe("30 พฤศจิกายน 2569");
  });

  test("อัตราจ่ายแบบกระชับ", () => {
    expect(compactRate("900.0000")).toBe("900");
    expect(compactRate("3.2000")).toBe("3.2");
  });
});

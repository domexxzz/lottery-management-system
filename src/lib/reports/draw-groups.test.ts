import { describe, expect, test } from "vitest";
import { groupReportDraws, normalizeReportLotteries } from "./draw-groups";

const at = new Date("2026-11-20T13:30:00Z");
const draw = (id: string, lotteryType: "THAI_GOVERNMENT" | "LAO" | "LAO_SET", laoFamilyId: string | null) => ({
  id,
  lotteryType,
  laoFamilyId,
  name: id,
  drawDate: new Date("2026-11-20T00:00:00Z"),
  cutoffAt: at,
  status: "OPEN" as const,
});

describe("หมวดงวดของรายงาน", () => {
  test("ลาวและลาวชุด family เดียวกันแสดงเป็นงวดเดียวและเก็บ id ทั้งคู่", () => {
    const rows = groupReportDraws([
      draw("lao-set", "LAO_SET", "family-1"),
      draw("thai", "THAI_GOVERNMENT", null),
      draw("lao", "LAO", "family-1"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.category === "LAO_COMBINED")).toMatchObject({
      id: "lao",
      memberIds: ["lao-set", "lao"],
      category: "LAO_COMBINED",
    });
  });

  test("ลิงก์เดิมที่เลือกลาวหรือลาวชุดเพียงอย่างเดียวถูกขยายเป็นคู่", () => {
    expect(normalizeReportLotteries(["LAO"])).toEqual(["LAO", "LAO_SET"]);
    expect(normalizeReportLotteries(["LAO_SET"])).toEqual(["LAO", "LAO_SET"]);
    expect(normalizeReportLotteries(["THAI_GOVERNMENT", "LAO"])).toEqual(["THAI_GOVERNMENT", "LAO", "LAO_SET"]);
  });
});

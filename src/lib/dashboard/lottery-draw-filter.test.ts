import { describe, expect, it } from "vitest";
import { resolveDashboardDrawScope, type DashboardPhysicalDraw } from "./lottery-draw-filter";

const date = new Date("2026-11-23T13:30:00.000Z");
const draws: DashboardPhysicalDraw[] = [
  { id: "thai", name: "หวยรัฐบาล 1/12/2026", drawDate: new Date("2026-12-01T00:00:00.000Z"), cutoffAt: date, status: "OPEN", lotteryType: "THAI_GOVERNMENT", laoFamilyId: null },
  { id: "lao", name: "หวยลาว 23/11/2026", drawDate: new Date("2026-11-23T00:00:00.000Z"), cutoffAt: date, status: "OPEN", lotteryType: "LAO", laoFamilyId: "family-1" },
  { id: "lao-set", name: "หวยลาวชุด 23/11/2026", drawDate: new Date("2026-11-23T00:00:00.000Z"), cutoffAt: date, status: "OPEN", lotteryType: "LAO_SET", laoFamilyId: "family-1" },
];

describe("resolveDashboardDrawScope", () => {
  it("defaults to every lottery type and every draw", () => {
    const scope = resolveDashboardDrawScope(draws, undefined, undefined);
    expect(scope.category).toBe("ALL");
    expect(scope.drawIds).toBeUndefined();
    expect(scope.logicalDraws).toHaveLength(2);
  });

  it("filters all Thai government draws", () => {
    const scope = resolveDashboardDrawScope(draws, "THAI_GOVERNMENT", undefined);
    expect(scope.category).toBe("THAI_GOVERNMENT");
    expect(scope.drawIds).toEqual(["thai"]);
  });

  it("combines Lao and Lao Set from the same family", () => {
    const scope = resolveDashboardDrawScope(draws, "LAO_COMBINED", "lao");
    expect(scope.category).toBe("LAO_COMBINED");
    expect(scope.selectedDraw?.memberIds).toEqual(expect.arrayContaining(["lao", "lao-set"]));
    expect(scope.drawIds).toEqual(expect.arrayContaining(["lao", "lao-set"]));
  });

  it("upgrades an old Lao Set URL to the combined Lao category", () => {
    const scope = resolveDashboardDrawScope(draws, undefined, "lao-set");
    expect(scope.category).toBe("LAO_COMBINED");
    expect(scope.selectedDraw?.id).toBe("lao");
    expect(scope.drawIds).toEqual(expect.arrayContaining(["lao", "lao-set"]));
  });
});


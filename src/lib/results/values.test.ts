import { describe, expect, it } from "vitest";
import { displayResultValues, resultValueCount, storedResultValues } from "./values";

describe("multiple result values", () => {
  it("requires two official numbers for front-three and back-three", () => {
    expect(resultValueCount(3)).toBe(2);
    expect(resultValueCount(4)).toBe(2);
    expect(resultValueCount(1)).toBe(1);
  });

  it("falls back to the legacy value for existing rows", () => {
    expect(storedResultValues({ value: "123", values: [] })).toEqual(["123"]);
    expect(displayResultValues({ value: "123", values: ["300", "950"] })).toBe("300 · 950");
  });
});

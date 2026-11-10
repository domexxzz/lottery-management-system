import { describe, expect, test } from "vitest";
import { exposureHref, pageWindow, parseExposureParams } from "./exposure-query";

describe("parseExposureParams", () => {
  test("ค่าเริ่มต้น: เลขใกล้เต็ม เรียงตาม % ใช้วงเงินมากสุด หน้าแรก", () => {
    expect(parseExposureParams({})).toEqual({ drawId: "", status: "near", type: "", q: "", sort: "percent", dir: "desc", page: 1 });
  });

  test("ค่าแปลกตกไปที่ค่าเริ่มต้น และค้นหาเก็บเฉพาะตัวเลข", () => {
    const parsed = parseExposureParams({ status: "x", sort: "drop table", dir: "up", page: "-3", q: "1a2;3" });
    expect(parsed).toMatchObject({ status: "near", sort: "percent", dir: "desc", page: 1, q: "123" });
  });

  test("คงเหลือเรียงน้อยไปมากเป็นค่าเริ่มต้น", () => {
    expect(parseExposureParams({ sort: "remaining" }).dir).toBe("asc");
  });
});

describe("exposureHref", () => {
  const base = parseExposureParams({ drawId: "d1", status: "near", page: "3" });

  test("เปลี่ยนตัวกรองแล้วกลับหน้าแรก ค่าเริ่มต้นไม่ใส่ใน URL", () => {
    expect(exposureHref(base, { status: "full" })).toBe("/numbers?drawId=d1&status=full");
  });

  test("เปลี่ยนหน้าเก็บตัวกรองเดิม", () => {
    expect(exposureHref(base, { page: 4 })).toBe("/numbers?drawId=d1&status=near&page=4");
  });

  test("เรียงสวนทางค่าเริ่มต้นใส่ dir", () => {
    expect(exposureHref(base, { sort: "used", dir: "asc" })).toBe("/numbers?drawId=d1&status=near&sort=used&dir=asc");
  });
});

describe("pageWindow", () => {
  test("หน้าแรก สุดท้าย และรอบหน้าปัจจุบัน คั่นด้วยช่องว่าง", () => {
    expect(pageWindow(5, 10)).toEqual([1, "gap", 4, 5, 6, "gap", 10]);
    expect(pageWindow(1, 2)).toEqual([1, 2]);
  });
});

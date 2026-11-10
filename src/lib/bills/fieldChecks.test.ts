import { describe, expect, test } from "vitest";
import { checkNumberField, checkRowComplete, checkStakeField } from "./fieldChecks";

describe("checkNumberField", () => {
  test("แถวว่างไม่ถือเป็นข้อผิดพลาด", () => {
    expect(checkNumberField("", 3)).toBeNull();
    expect(checkNumberField("   ", 3)).toBeNull();
  });

  test("ยอมรับเลขที่ยาวตรงกับจำนวนหลัก", () => {
    expect(checkNumberField("123", 3)).toBeNull();
    expect(checkNumberField("007", 3)).toBeNull();
  });

  test("ปฏิเสธตัวอักษรปน", () => {
    expect(checkNumberField("12a", 3)).toBe("ต้องเป็นตัวเลขเท่านั้น");
  });

  test("ปฏิเสธความยาวไม่ตรง", () => {
    expect(checkNumberField("12", 3)).toBe("ต้องกรอก 3 หลัก");
    expect(checkNumberField("1234", 3)).toBe("ต้องกรอก 3 หลัก");
  });
});

describe("checkStakeField", () => {
  test("ยอมรับจำนวนเต็มและทศนิยมไม่เกินสองตำแหน่ง", () => {
    expect(checkStakeField("5")).toBeNull();
    expect(checkStakeField("100")).toBeNull();
    expect(checkStakeField("100.5")).toBeNull();
    expect(checkStakeField("100.55")).toBeNull();
  });

  test("ปฏิเสธทศนิยมเกินสองตำแหน่ง", () => {
    expect(checkStakeField("100.555")).toBe("ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง");
  });

  test("ปฏิเสธค่าติดลบและศูนย์", () => {
    expect(checkStakeField("-5")).toBe("ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง");
    expect(checkStakeField("0")).toBe("ต้องมากกว่า 0");
  });

  test("ปฏิเสธยอดเดิมพันต่ำกว่า 5 บาท", () => {
    expect(checkStakeField("1")).toBe("ขั้นต่ำ 5 บาท");
    expect(checkStakeField("4.99")).toBe("ขั้นต่ำ 5 บาท");
  });

  test("ปฏิเสธข้อความที่ไม่ใช่ตัวเลข", () => {
    expect(checkStakeField("หนึ่งร้อย")).toBe("ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง");
  });
});

describe("checkRowComplete", () => {
  test("แถวว่างทั้งคู่ผ่าน", () => {
    expect(checkRowComplete("", "")).toBeNull();
  });

  test("แถวกรอกครบผ่าน", () => {
    expect(checkRowComplete("123", "100")).toBeNull();
  });

  test("กรอกเลขแต่ไม่กรอกยอด", () => {
    expect(checkRowComplete("123", "")).toBe("กรอกยอดเดิมพันด้วย");
  });

  test("กรอกยอดแต่ไม่กรอกเลข", () => {
    expect(checkRowComplete("", "100")).toBe("กรอกเลขด้วย");
  });
});

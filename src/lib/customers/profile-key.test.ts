import { describe, expect, test } from "vitest";
import { customerNameFromProfileKey, customerProfileKey } from "./profile-key";

describe("customer profile key", () => {
  test("เข้ารหัสและถอดรหัสชื่อภาษาไทยได้", () => {
    const name = "ลูกค้า สมชาย ใจดี";
    expect(customerNameFromProfileKey(customerProfileKey(name))).toBe(name);
  });

  test("ปฏิเสธ key ที่ไม่ถูกต้อง", () => {
    expect(customerNameFromProfileKey("../customer")).toBeNull();
    expect(customerNameFromProfileKey("")).toBeNull();
  });
});

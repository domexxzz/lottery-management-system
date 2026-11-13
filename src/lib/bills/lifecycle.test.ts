import { describe, expect, test } from "vitest";
import type { BillStatus } from "@prisma/client";
import { canTransition } from "./lifecycle";

const ALL: BillStatus[] = ["DRAFT", "CONFIRMED", "LOCKED", "SETTLED", "CANCELLED"];

describe("Bill state machine", () => {
  test("เส้นทางปกติเดินได้", () => {
    expect(canTransition("DRAFT", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "LOCKED")).toBe(true);
    expect(canTransition("LOCKED", "SETTLED")).toBe(true);
  });

  test("ลบได้เฉพาะสถานะก่อนปิดรับ", () => {
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
    expect(canTransition("CONFIRMED", "CANCELLED")).toBe(true);
    expect(canTransition("LOCKED", "CANCELLED")).toBe(false);
  });

  test("SETTLED และ CANCELLED เป็นสถานะปลายทาง ออกไปไหนไม่ได้", () => {
    for (const to of ALL) {
      expect(canTransition("SETTLED", to)).toBe(false);
      expect(canTransition("CANCELLED", to)).toBe(false);
    }
  });

  test("ข้ามขั้นไม่ได้", () => {
    expect(canTransition("DRAFT", "LOCKED")).toBe(false);
    expect(canTransition("DRAFT", "SETTLED")).toBe(false);
    expect(canTransition("CONFIRMED", "SETTLED")).toBe(false);
  });

  test("ย้อนกลับไม่ได้", () => {
    expect(canTransition("CONFIRMED", "DRAFT")).toBe(false);
    expect(canTransition("LOCKED", "CONFIRMED")).toBe(false);
    expect(canTransition("SETTLED", "LOCKED")).toBe(false);
  });

  test("อยู่สถานะเดิมไม่นับเป็น transition ที่ถูกต้อง", () => {
    for (const s of ALL) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});

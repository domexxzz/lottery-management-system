import { describe, expect, test } from "vitest";
import {
  canCorrectInDrawStatus,
  correctionInvalidatesSettlement,
  isCorrection,
  shouldApproveResultOnEntry,
} from "./policy";

describe("ยืนยันผลในขั้นตอนเดียว", () => {
  test.each(["OWNER", "ADMIN"] as const)("%s บันทึกแล้วอนุมัติทันที", (role) => {
    expect(shouldApproveResultOnEntry(role)).toBe(true);
  });

  test("Agent ไม่มีสิทธิ์อนุมัติอัตโนมัติ", () => {
    expect(shouldApproveResultOnEntry("AGENT")).toBe(false);
  });
});

describe("แก้ผลที่ประกาศแล้ว", () => {
  test("ผลที่อนุมัติแล้วเท่านั้นที่นับเป็นการแก้", () => {
    expect(isCorrection("APPROVED")).toBe(true);
    expect(isCorrection("DRAFT")).toBe(false);
    expect(isCorrection("REJECTED")).toBe(false);
    expect(isCorrection(null)).toBe(false);
  });

  test("รอบที่ปิดบัญชีแล้วแก้ผลไม่ได้", () => {
    expect(canCorrectInDrawStatus("CLOSED")).toBe(false);
    for (const status of ["LOCKED", "RESULT_PENDING", "SETTLED"]) {
      expect(canCorrectInDrawStatus(status)).toBe(true);
    }
  });

  test("แก้ผลหลังคำนวณแล้วทำให้ยอดที่คำนวณไว้ใช้ไม่ได้", () => {
    expect(correctionInvalidatesSettlement("SETTLED")).toBe(true);
    // ยังไม่เคยคำนวณ จึงไม่มียอดให้ล้าง
    expect(correctionInvalidatesSettlement("RESULT_PENDING")).toBe(false);
    expect(correctionInvalidatesSettlement("LOCKED")).toBe(false);
  });
});

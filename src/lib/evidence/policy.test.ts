import { describe, expect, test } from "vitest";
import { canManageDraftEvidence, canReplaceRejectedEvidence, canReviewEvidence } from "./policy";

describe("evidence policy", () => {
  test("Agent จัดการไฟล์ใหม่ได้เฉพาะบิลร่าง", () => {
    expect(canManageDraftEvidence({ role: "AGENT", billStatus: "DRAFT" })).toBe(true);
    expect(canManageDraftEvidence({ role: "AGENT", billStatus: "CONFIRMED" })).toBe(false);
    expect(canManageDraftEvidence({ role: "ADMIN", billStatus: "DRAFT" })).toBe(true);
  });

  test("เปลี่ยนได้เฉพาะไฟล์ที่ถูกตีกลับและบิลยังไม่จบ", () => {
    expect(canReplaceRejectedEvidence({ role: "AGENT", billStatus: "CONFIRMED", attachmentStatus: "REJECTED" })).toBe(true);
    expect(canReplaceRejectedEvidence({ role: "AGENT", billStatus: "SETTLED", attachmentStatus: "REJECTED" })).toBe(false);
    expect(canReplaceRejectedEvidence({ role: "AGENT", billStatus: "CONFIRMED", attachmentStatus: "PENDING" })).toBe(false);
  });

  test("เฉพาะ Owner และ Admin ตรวจหลักฐานได้", () => {
    expect(canReviewEvidence("OWNER")).toBe(true);
    expect(canReviewEvidence("ADMIN")).toBe(true);
    expect(canReviewEvidence("AGENT")).toBe(false);
  });
});

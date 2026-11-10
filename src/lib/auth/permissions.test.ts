import { describe, expect, test } from "vitest";
import { can, PERMISSIONS } from "./permissions";

describe("Godmode เป็นผู้ดูแลระบบสูงสุด", () => {
  test("มีสิทธิ์ครบทุกความสามารถที่ระบบประกาศ", () => {
    for (const permission of PERMISSIONS) expect(can("GODMODE", permission)).toBe(true);
  });
});

describe("Admin เป็นผู้ปฏิบัติงานและผู้ตรวจ", () => {
  test("Admin กรอกและยืนยันผลได้", () => {
    expect(can("ADMIN", "result.enter")).toBe(true);
    expect(can("ADMIN", "result.approve")).toBe(true);
  });

  test("Admin จัดการ Agent ไม่ได้", () => {
    expect(can("ADMIN", "agent.manage")).toBe(false);
    expect(can("ADMIN", "user.manage")).toBe(false);
  });

  test("Owner ยังจัดการ Agent ได้ตามบทบาทเจ้าของกิจการ", () => {
    expect(can("OWNER", "agent.manage")).toBe(true);
    expect(can("OWNER", "system.override")).toBe(false);
  });

  test("Agent, Admin และ Owner ลบบิลก่อนปิดรับได้ตามขอบเขตของตน", () => {
    for (const role of ["AGENT", "ADMIN", "OWNER"] as const) {
      expect(can(role, "bill.delete")).toBe(true);
    }
  });

  test("สิทธิ์ลบงวดและหลักฐานยังเป็นของ Owner", () => {
    for (const permission of ["draw.delete", "evidence.delete"] as const) {
      expect(can("OWNER", permission)).toBe(true);
      expect(can("ADMIN", permission)).toBe(false);
      expect(can("AGENT", permission)).toBe(false);
    }
  });
});

describe("สิทธิ์การแก้ผลที่ประกาศแล้ว", () => {
  test("Admin เสนอแก้ได้ แต่อนุมัติการแก้เองไม่ได้", () => {
    expect(can("ADMIN", "result.proposeCorrection")).toBe(true);
    expect(can("ADMIN", "result.approveCorrection")).toBe(false);
  });

  test("Owner มีสิทธิ์อนุมัติการแก้ผล รวมถึงการแก้เองแบบมีผลทันที", () => {
    expect(can("OWNER", "result.approveCorrection")).toBe(true);
  });

  test("Agent ไม่เกี่ยวข้องกับผลรางวัล", () => {
    expect(can("AGENT", "result.proposeCorrection")).toBe(false);
    expect(can("AGENT", "result.approveCorrection")).toBe(false);
  });
});

import { describe, expect, test } from "vitest";
import { can } from "./permissions";

describe("Admin เป็นผู้ปฏิบัติงานและผู้ตรวจ", () => {
  test("Admin กรอกและยืนยันผลได้", () => {
    expect(can("ADMIN", "result.enter")).toBe(true);
    expect(can("ADMIN", "result.approve")).toBe(true);
  });

  test("Admin จัดการ Agent ไม่ได้", () => {
    expect(can("ADMIN", "agent.manage")).toBe(false);
    expect(can("ADMIN", "user.manage")).toBe(false);
  });

  test("Owner ยังเป็นผู้เดียวที่จัดการ Agent ได้", () => {
    expect(can("OWNER", "agent.manage")).toBe(true);
  });
});

describe("การแก้ผลที่ประกาศแล้วต้องใช้สองคน", () => {
  test("Admin เสนอแก้ได้ แต่อนุมัติการแก้เองไม่ได้", () => {
    expect(can("ADMIN", "result.proposeCorrection")).toBe(true);
    expect(can("ADMIN", "result.approveCorrection")).toBe(false);
  });

  test("Owner เป็นผู้อนุมัติการแก้ผล", () => {
    expect(can("OWNER", "result.approveCorrection")).toBe(true);
  });

  test("Agent ไม่เกี่ยวข้องกับผลรางวัล", () => {
    expect(can("AGENT", "result.proposeCorrection")).toBe(false);
    expect(can("AGENT", "result.approveCorrection")).toBe(false);
  });
});

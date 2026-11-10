import { describe, expect, test } from "vitest";
import { agentIdentityAfter, displayLogin, validateOwnerSetPassword } from "./identity";

describe("ชื่อผู้ใช้และรหัส Agent อัตโนมัติ", () => {
  test("เริ่มที่ A1 เมื่อยังไม่มีบัญชี Agent อัตโนมัติ", () => {
    expect(agentIdentityAfter(["owner", "admin", "agent", "agent2"], [])).toEqual({ login: "a1", code: "A1" });
  });

  test("นับต่อจากเลขสูงสุดของทั้งชื่อผู้ใช้และรหัส Agent", () => {
    expect(agentIdentityAfter(["a1", "a2", "a9"], ["A1", "A2"])).toEqual({ login: "a10", code: "A10" });
    // รหัสแบบเดิมที่เติมศูนย์ (A005) ก็นับด้วย ชื่อผู้ใช้กับรหัสจึงไม่ชนกัน
    expect(agentIdentityAfter(["a3"], ["A001", "A005"])).toEqual({ login: "a6", code: "A6" });
  });

  test("ไม่นับชื่อที่ไม่ใช่รูปแบบอัตโนมัติ", () => {
    expect(agentIdentityAfter(["admin1", "a1b", "aa2"], ["AG3", "B4"])).toEqual({ login: "a1", code: "A1" });
  });

  test("แสดงชื่อผู้ใช้อัตโนมัติเป็นตัวพิมพ์ใหญ่", () => {
    expect(displayLogin("a7")).toBe("A7");
    expect(displayLogin("admin")).toBe("admin");
  });

  test("รหัสผ่านที่ Owner ตั้ง ไม่มีข้อกำหนดนอกจากห้ามว่าง", () => {
    expect(validateOwnerSetPassword("1")).toBeNull();
    expect(validateOwnerSetPassword("พี่เบส")).toBeNull();
    expect(validateOwnerSetPassword("")).not.toBeNull();
  });
});

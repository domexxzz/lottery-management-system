import { describe, expect, test } from "vitest";
import { quickActionsFor } from "./quick-actions";

const STATUSES = ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED", "CLOSED"] as const;

describe("ปุ่มลัดเปลี่ยนตามสถานะรอบ", () => {
  test("ทุกสถานะมีปุ่มงานที่ต้องดำเนินการและตรวจสอบข้อมูลเสมอ", () => {
    for (const status of [...STATUSES, null]) {
      const labels = quickActionsFor(status).map((a) => a.label);
      expect(labels).toContain("งานที่ต้องดำเนินการ");
      expect(labels).toContain("ตรวจสอบข้อมูล");
    }
  });

  test("รอบที่เปิดรับถามเรื่องเวลาปิดรับได้ รอบที่ปิดบัญชีแล้วไม่ถาม", () => {
    expect(quickActionsFor("OPEN").map((a) => a.label)).toContain("เหลือเวลาปิดรับ");
    expect(quickActionsFor("CLOSED").map((a) => a.label)).not.toContain("เหลือเวลาปิดรับ");
  });

  test("ถามเรื่องการลงผลเฉพาะตอนที่ลงผลได้", () => {
    expect(quickActionsFor("LOCKED").map((a) => a.label)).toContain("ลงผลครบหรือยัง");
    expect(quickActionsFor("RESULT_PENDING").map((a) => a.label)).toContain("ผลที่ยังไม่ลง");
    expect(quickActionsFor("OPEN").map((a) => a.label)).not.toContain("ลงผลครบหรือยัง");
  });

  test("ถามกำไรขาดทุนเฉพาะตอนคำนวณแล้ว", () => {
    expect(quickActionsFor("SETTLED").map((a) => a.label)).toContain("กำไรขาดทุนรอบนี้");
    expect(quickActionsFor("OPEN").map((a) => a.label)).not.toContain("กำไรขาดทุนรอบนี้");
  });

  test("ยังไม่มีรอบในระบบ ไม่เสนอปุ่มที่ต้องมีรอบ", () => {
    const labels = quickActionsFor(null).map((a) => a.label);
    expect(labels).toContain("ภาพรวมระบบตอนนี้");
    expect(labels).not.toContain("ยอดขายรอบนี้");
  });

  test("สถานะที่ไม่รู้จักยังได้ปุ่มพื้นฐาน ไม่พัง", () => {
    expect(quickActionsFor("SOMETHING_NEW").map((a) => a.label)).toEqual(["งานที่ต้องดำเนินการ", "ตรวจสอบข้อมูล", "แนะนำระบบ"]);
  });

  test("ทุกสถานะมีปุ่มแนะนำระบบเป็นปุ่มสุดท้าย และกดได้แม้ยังไม่ตั้งค่าผู้ช่วย", () => {
    for (const status of [...STATUSES, null]) {
      const actions = quickActionsFor(status);
      expect(actions.at(-1)).toMatchObject({ label: "แนะนำระบบ", prompt: "แนะนำระบบ", offline: true });
      expect(actions.filter((a) => a.label === "แนะนำระบบ")).toHaveLength(1);
    }
  });

  test("แต่ละสถานะมีปุ่มข้อมูลไม่เกิน 4 ปุ่ม บวกปุ่มแนะนำระบบ", () => {
    for (const status of [...STATUSES, null, "SOMETHING_NEW"]) {
      const actions = quickActionsFor(status);
      expect(actions.length).toBeGreaterThan(0);
      expect(actions.length).toBeLessThanOrEqual(5);
    }
  });

  test("ทุกปุ่มมีข้อความและคำถามจริง ไม่มีปุ่มว่าง", () => {
    for (const status of [...STATUSES, null]) {
      for (const action of quickActionsFor(status)) {
        expect(action.label.trim().length).toBeGreaterThan(0);
        // คำถามต้องยาวกว่าป้ายปุ่ม เพราะเขียนเต็มเพื่อให้โมเดลตอบตรงจุด
        // ยกเว้นปุ่มที่ตอบจากคู่มือในระบบ ซึ่งส่งคำสั่งสั้นตามป้ายตรง ๆ
        if (!action.offline) expect(action.prompt.length).toBeGreaterThan(action.label.length);
      }
    }
  });

  test("ป้ายปุ่มไม่ซ้ำกันในสถานะเดียวกัน", () => {
    for (const status of [...STATUSES, null]) {
      const labels = quickActionsFor(status).map((a) => a.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });
});

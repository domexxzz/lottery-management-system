import { describe, expect, test } from "vitest";
import type { Role } from "@prisma/client";
import { canConverse, isStaff } from "./policy";

/**
 * กฎว่าใครคุยกับใครได้
 *
 * กฎนี้คือเหตุผลเดียวที่ระบบแชทต้องมีชั้นสิทธิ์ ถ้ามันพลาด ข้อมูลยอดและราคา
 * จะไหลข้ามตัวแทนผ่านช่องทางที่ตรวจย้อนหลังไม่ได้ จึงต้องครอบทุกคู่ที่เป็นไปได้
 * ไม่ใช่เฉพาะกรณีที่นึกออก
 */

const ROLES: Role[] = ["OWNER", "ADMIN", "AGENT"];

describe("ใครคุยกับใครได้", () => {
  test("Agent คุยกันเองไม่ได้", () => {
    expect(canConverse("AGENT", "AGENT")).toBe(false);
  });

  test("Agent คุยกับ Owner และ Admin ได้", () => {
    expect(canConverse("AGENT", "OWNER")).toBe(true);
    expect(canConverse("AGENT", "ADMIN")).toBe(true);
  });

  test("Owner และ Admin คุยได้กับทุกคน รวมถึงกันเอง", () => {
    expect(canConverse("OWNER", "ADMIN")).toBe(true);
    expect(canConverse("OWNER", "OWNER")).toBe(true);
    expect(canConverse("ADMIN", "ADMIN")).toBe(true);
  });

  test("ไม่สนใจลำดับ คุยได้ต้องได้ทั้งสองทาง", () => {
    for (const a of ROLES) {
      for (const b of ROLES) {
        expect(canConverse(a, b)).toBe(canConverse(b, a));
      }
    }
  });

  test("คู่เดียวที่ถูกปฏิเสธคือ Agent กับ Agent", () => {
    const blocked = ROLES.flatMap((a) => ROLES.map((b) => [a, b] as const))
      .filter(([a, b]) => !canConverse(a, b));
    expect(blocked).toEqual([["AGENT", "AGENT"]]);
  });

  test("Owner และ Admin นับเป็นฝ่ายจัดการ ส่วน Agent ไม่ใช่", () => {
    expect(isStaff("OWNER")).toBe(true);
    expect(isStaff("ADMIN")).toBe(true);
    expect(isStaff("AGENT")).toBe(false);
  });
});

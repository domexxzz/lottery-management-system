import { afterAll, beforeEach, describe, expect, test } from "vitest";
import type { DrawStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { drawWhereOf } from "./draw-scope";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

const at = (iso: string) => new Date(iso);

async function makeDraw(name: string, status: DrawStatus, cutoffAt: Date, drawDate: Date | null) {
  return prisma.draw.create({
    data: { organizationId: f.org.id, name, status, opensAt: new Date(cutoffAt.getTime() - 86_400_000), cutoffAt, drawDate },
    select: { id: true, name: true },
  });
}

async function namesIn(scope: "current" | "past" | "all", now: Date) {
  const rows = await prisma.draw.findMany({
    where: { organizationId: f.org.id, ...drawWhereOf(scope, now) },
    select: { name: true },
  });
  return rows.map((row) => row.name).sort();
}

describe("เงื่อนไขงวดปัจจุบัน/ย้อนหลังในฐานข้อมูล", () => {
  test("งวดที่ออกรางวัลไม่เกิน 2 วันยังเป็นงวดปัจจุบัน ทั้งงวดที่มีและไม่มี drawDate", async () => {
    await prisma.draw.deleteMany({ where: { organizationId: f.org.id, bills: { none: {} } } });
    await makeDraw("16 settled", "SETTLED", at("2026-11-16T07:00:00Z"), at("2026-11-16T00:00:00Z"));
    await makeDraw("16 no-date locked", "LOCKED", at("2026-11-16T07:00:00Z"), null);
    await makeDraw("01 next open", "OPEN", at("2026-12-01T07:00:00Z"), at("2026-12-01T00:00:00Z"));
    await makeDraw("01 old locked", "LOCKED", at("2026-11-01T07:00:00Z"), at("2026-11-01T00:00:00Z"));
    await makeDraw("old no-date", "CLOSED", at("2026-10-16T07:00:00Z"), null);

    // 17 พ.ย. เวลาไทย: งวด 16 ยังเป็นงวดปัจจุบัน
    const nov17 = at("2026-11-17T10:00:00Z");
    expect(await namesIn("current", nov17)).toEqual(["01 next open", "16 no-date locked", "16 settled"]);
    expect(await namesIn("past", nov17)).toEqual(["01 old locked", "old no-date"]);

    // 18 พ.ย. เวลาไทย: งวด 16 ย้ายไปงวดย้อนหลัง
    const nov18 = at("2026-11-18T01:00:00Z");
    expect(await namesIn("current", nov18)).toEqual(["01 next open"]);
    expect(await namesIn("past", nov18)).toEqual(["01 old locked", "16 no-date locked", "16 settled", "old no-date"]);

    // ทุกงวดอยู่ในฝั่งใดฝั่งหนึ่งเสมอ ไม่หายและไม่ซ้ำ
    const all = await namesIn("all", nov18);
    expect([...(await namesIn("current", nov18)), ...(await namesIn("past", nov18))].sort()).toEqual(all);
  });
});

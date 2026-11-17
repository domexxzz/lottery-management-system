import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { getAnalyticsData } from "./service";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("เลขที่มีความต้องการสูง", () => {
  test("แสดงไม่เกิน 5 อันดับต่อประเภทรางวัล", async () => {
    const { billId } = await createDraftBill(f.actors.AGENT1, {
      drawId: f.draw.id,
      title: "ลูกค้าทดสอบอันดับเลข",
    });

    await replaceDraftItems(f.actors.AGENT1, billId, [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "111", stake: "600" },
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "222", stake: "500" },
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "333", stake: "400" },
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "444", stake: "300" },
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "555", stake: "200" },
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "666", stake: "100" },
    ]);
    await confirmBill(f.actors.AGENT1, billId);

    const analytics = await getAnalyticsData({
      organizationId: f.org.id,
      drawId: f.draw.id,
    });

    const prizeTypeId = f.prizeTypes.threeTop.id;
    expect(analytics.prizeNumbers).toEqual([
      { prizeTypeId, prizeLabel: "หวยรัฐบาล · 3 ตัวบน", number: "111", count: 1, stake: 600 },
      { prizeTypeId, prizeLabel: "หวยรัฐบาล · 3 ตัวบน", number: "222", count: 1, stake: 500 },
      { prizeTypeId, prizeLabel: "หวยรัฐบาล · 3 ตัวบน", number: "333", count: 1, stake: 400 },
      { prizeTypeId, prizeLabel: "หวยรัฐบาล · 3 ตัวบน", number: "444", count: 1, stake: 300 },
      { prizeTypeId, prizeLabel: "หวยรัฐบาล · 3 ตัวบน", number: "555", count: 1, stake: 200 },
    ]);
  });
});

describe("การนับลูกค้า", () => {
  test("ลูกค้านับตาม Agent + ชื่อที่ทำความสะอาดแล้ว", async () => {
    const { placeBill } = await import("@/lib/bills/service");
    const item = [{ prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "10" }];
    // Agent 1: "สมชาย", " คุณสมชาย ", "สมชาย" → คนเดียวกัน 3 ครั้ง · "คุณากร" ไม่ถูกตัดเป็น "ากร"
    for (const title of ["สมชาย", " คุณสมชาย ", "สมชาย", "คุณากร"]) {
      await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title, items: item });
    }
    // Agent 2 มีลูกค้าชื่อ "สมชาย" อีกคน ต้องนับแยก
    await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "สมชาย", items: item });

    const analytics = await getAnalyticsData({ organizationId: f.org.id, drawId: f.draw.id });

    expect(analytics.customerCount).toBe(3);
    expect(analytics.repeatCustomers).toBe(1);
    expect(analytics.unknownBills).toBe(0);
    const top = analytics.customers[0]!;
    expect(top).toMatchObject({ agentCode: "A001", bills: 3 });
    expect(analytics.customers.map((row) => row.name)).toContain("คุณากร");
  });
});

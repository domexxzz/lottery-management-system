import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { confirmBill, createDraftBill, replaceDraftItems } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { enterResult } from "@/lib/results/service";
import { calculateSettlement } from "@/lib/settlement/service";
import { QUERY_TOOLS, runQueryTool, toolCatalog } from "./query-tools";
import { buildMarketInsight } from "./market";

/**
 * คิวรีที่ผู้ช่วยเรียกใช้เองได้
 *
 * สิ่งที่ชุดนี้ต้องพิสูจน์
 *   1. ตัวเลขถูกต้อง เพราะคำนวณในฐานข้อมูล
 *   2. ขอบเขตองค์กรผูกไว้แน่น แม้พารามิเตอร์จะมาจากโมเดลภาษา
 *   3. พารามิเตอร์แปลก ๆ หรือชื่อเครื่องมือมั่ว ต้องถูกปฏิเสธ ไม่ใช่หลุดไปถึง SQL
 */

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function billFor(
  title: string,
  items: { prizeTypeId: string; number: string; stake: string }[],
  drawId = f.draw.id,
  actor: Fixtures["actors"]["AGENT1"] = f.actors.AGENT1,
) {
  const { billId } = await createDraftBill(actor, { drawId, title });
  await replaceDraftItems(actor, billId, items);
  await confirmBill(actor, billId);
  return billId;
}

describe("ความปลอดภัยของชั้นคิวรี", () => {
  test("ชื่อเครื่องมือที่ไม่รู้จักถูกปฏิเสธ", async () => {
    const result = await runQueryTool(f.actors.OWNER, "drop_everything", {});
    expect(result).toEqual({ tool: "drop_everything", error: "ไม่รู้จักเครื่องมือนี้" });
  });

  test("พารามิเตอร์ที่ผิดรูปแบบถูกปฏิเสธก่อนถึง SQL", async () => {
    const result = await runQueryTool(f.actors.OWNER, "customer_ranking", {
      metric: "'; DROP TABLE bills; --",
    });
    expect("error" in result).toBe(true);
  });

  test("limit เกินเพดานถูกปฏิเสธ ไม่ให้ดึงทั้งตาราง", async () => {
    const result = await runQueryTool(f.actors.OWNER, "customer_ranking", { limit: 100000 });
    expect("error" in result).toBe(true);
  });

  test("ข้อความแปลกในพารามิเตอร์ที่เป็นสตริงถูกผูกเป็นค่า ไม่ใช่ SQL", async () => {
    await billFor("ลูกค้าปกติ", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    // ถ้าต่อสตริงเข้า SQL ตรงนี้จะพังหรือคืนข้อมูลผิด แต่ที่ถูกคือคืน 0 แถว
    const result = await runQueryTool(f.actors.OWNER, "customer_detail", {
      customerReference: "' OR 1=1 --",
    });
    expect("rows" in result && result.rowCount).toBe(0);
  });

  test("เครื่องมือที่ไม่บังคับพารามิเตอร์ เรียกด้วยค่าว่างได้โดยไม่ล้ม", async () => {
    // customer_detail บังคับให้ระบุลูกค้า จึงต้องปฏิเสธเมื่อไม่ส่งมา
    const requiresParams = new Set(["customer_detail"]);
    for (const tool of QUERY_TOOLS) {
      const result = await runQueryTool(f.actors.OWNER, tool.name, {});
      expect("error" in result, `${tool.name}`).toBe(requiresParams.has(tool.name));
    }
  });

  test("แคตตาล็อกตรงกับเครื่องมือที่มีจริง ชื่อไม่ซ้ำ และมีคำอธิบายครบ", () => {
    const catalog = toolCatalog();
    expect(catalog).toHaveLength(QUERY_TOOLS.length);
    expect(new Set(catalog.map((t) => t.name)).size).toBe(catalog.length);
    for (const tool of catalog) {
      expect(tool.description.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("ความถูกต้องของตัวเลข", () => {
  test("จัดอันดับลูกค้าตามยอดซื้อ", async () => {
    await billFor("รายใหญ่", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "111", stake: "300" },
    ]);
    await billFor("รายเล็ก", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "222", stake: "50" },
    ]);

    const result = await runQueryTool(f.actors.OWNER, "customer_ranking", { metric: "spend" });
    expect("rows" in result).toBe(true);
    if (!("rows" in result)) return;

    expect(result.rowCount).toBe(2);
    expect(result.rows[0]).toMatchObject({
      rank: 1,
      customerReference: "รายใหญ่",
      totalSpend: "300.00",
    });
    expect(result.coverage).toContain("ยืนยันแล้ว");
  });

  test("จัดอันดับลูกค้าตามจำนวนบิลได้ผลต่างจากตามยอดซื้อ", async () => {
    await billFor("ซื้อแพงครั้งเดียว", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "111", stake: "1000" },
    ]);
    await billFor("ซื้อถี่", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "222", stake: "10" },
    ]);
    await billFor("ซื้อถี่", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "333", stake: "10" },
    ]);

    const bySpend = await runQueryTool(f.actors.OWNER, "customer_ranking", { metric: "spend" });
    const byBills = await runQueryTool(f.actors.OWNER, "customer_ranking", { metric: "bills" });
    if (!("rows" in bySpend) || !("rows" in byBills)) throw new Error("expected rows");

    expect(bySpend.rows[0]!.customerReference).toBe("ซื้อแพงครั้งเดียว");
    expect(byBills.rows[0]!.customerReference).toBe("ซื้อถี่");
  });

  test("อันดับกำไรรายรอบเรียงตาม net และสลับทิศได้", async () => {
    await billFor("ลูกค้า", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    await enterResult(f.actors.ADMIN, {
      drawId: f.draw.id,
      prizeTypeId: f.prizeTypes.threeTop.id,
      value: "999",
    });
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    const best = await runQueryTool(f.actors.OWNER, "draw_profit_ranking", { order: "best" });
    if (!("rows" in best)) throw new Error("expected rows");
    expect(best.rows[0]).toMatchObject({ drawName: "งวดทดสอบ", net: "75.00" });

    const worst = await runQueryTool(f.actors.OWNER, "draw_profit_ranking", { order: "worst" });
    if (!("rows" in worst)) throw new Error("expected rows");
    expect(worst.rows[0]!.net).toBe("75.00");
  });

  test("ภาระผูกพันคูณอัตราจ่ายที่ล็อกไว้", async () => {
    await billFor("ลูกค้า", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    const result = await runQueryTool(f.actors.OWNER, "risk_by_number", {});
    if (!("rows" in result)) throw new Error("expected rows");
    expect(result.rows[0]).toMatchObject({ number: "123", payoutIfWins: "90000.00" });
  });

  test("ไม่มีข้อมูลคืน rowCount 0 พร้อมบอกช่วงที่ตรวจ", async () => {
    const result = await runQueryTool(f.actors.OWNER, "risk_by_number", {});
    if (!("rows" in result)) throw new Error("expected rows");
    expect(result.rowCount).toBe(0);
    expect(result.coverage).toContain("ไม่มีภาระผูกพัน");
  });

  test("ยอดรายเดือนจัดกลุ่มตามเดือนของเวลาปิดรับ", async () => {
    await billFor("ลูกค้า", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    const result = await runQueryTool(f.actors.OWNER, "sales_by_month", {});
    if (!("rows" in result)) throw new Error("expected rows");
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]).toMatchObject({ sales: "100.00", bills: 1 });
    expect(String(result.rows[0]!.month)).toMatch(/^\d{4}-\d{2}$/);
  });

  test("สัดส่วนประเภทรางวัลรวมกันได้ 100", async () => {
    await billFor("ลูกค้า", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "75" },
      { prizeTypeId: f.prizeTypes.threeTod.id, number: "456", stake: "25" },
    ]);
    const result = await runQueryTool(f.actors.OWNER, "prize_type_mix", {});
    if (!("rows" in result)) throw new Error("expected rows");
    const total = result.rows.reduce((sum, row) => sum + Number(row.sharePercent), 0);
    expect(total).toBeCloseTo(100, 1);
    expect(result.rows[0]!.sharePercent).toBe("75.00");
  });
});

describe("ขอบเขตองค์กรในชั้นคิวรี", () => {
  test("ทุกเครื่องมือไม่คืนข้อมูลขององค์กรอื่น", async () => {
    await billFor("ลูกค้าของเรา", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);

    const otherOrg = await prisma.organization.create({
      data: { name: "องค์กรคู่แข่ง", timezone: "Asia/Bangkok" },
    });
    const otherPrize = await prisma.prizeType.create({
      data: {
        organizationId: otherOrg.id,
        code: 1,
        name: "3 ตัวบน",
        digits: 3,
        matchRule: "EXACT",
        payoutRate: "900",
      },
    });
    const otherAgent = await prisma.agent.create({
      data: {
        organizationId: otherOrg.id,
        code: "ZZ999",
        name: "ตัวแทนคู่แข่ง",
        commissionRate: "25",
      },
    });
    const otherUser = await prisma.user.create({
      data: {
        organizationId: otherOrg.id,
        login: "rival",
        displayName: "คู่แข่ง",
        passwordHash: "x",
        role: "OWNER",
        mustChangePassword: false,
      },
    });
    const otherDraw = await prisma.draw.create({
      data: {
        organizationId: otherOrg.id,
        name: "งวดคู่แข่ง",
        opensAt: new Date(Date.now() - 3_600_000),
        cutoffAt: new Date(Date.now() + 7_200_000),
        status: "OPEN",
      },
    });
    const otherBill = await prisma.bill.create({
      data: {
        organizationId: otherOrg.id,
        agentId: otherAgent.id,
        drawId: otherDraw.id,
        title: "ลูกค้าคู่แข่ง",
        status: "CONFIRMED",
        billNumber: "77777777",
        totalStake: "888888",
        createdById: otherUser.id,
      },
    });
    await prisma.billItem.create({
      data: {
        organizationId: otherOrg.id,
        billId: otherBill.id,
        prizeTypeId: otherPrize.id,
        number: "555",
        stake: "888888",
        payoutRateSnapshot: "900",
      },
    });

    for (const tool of QUERY_TOOLS) {
      const result = await runQueryTool(f.actors.OWNER, tool.name, {});
      const serialized = JSON.stringify(result);
      expect(serialized, `${tool.name} รั่ว`).not.toContain("คู่แข่ง");
      expect(serialized, `${tool.name} รั่ว`).not.toContain("ZZ999");
      expect(serialized, `${tool.name} รั่ว`).not.toContain("888888");
    }

    const market = JSON.stringify(await buildMarketInsight(f.actors.OWNER));
    expect(market).not.toContain("คู่แข่ง");
    expect(market).not.toContain("ZZ999");
  });
});

describe("มุมมองการตลาด", () => {
  test("คำนวณสัดส่วนและการกระจุกตัวของลูกค้า", async () => {
    await billFor("รายใหญ่", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "111", stake: "900" },
    ]);
    await billFor("รายเล็ก", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "222", stake: "100" },
    ]);

    const market = await buildMarketInsight(f.actors.OWNER);

    expect(market.customerConcentration.totalCustomers).toBe(2);
    // ลูกค้า 2 รายรวมกันคือ 100% ของยอดอยู่แล้ว
    expect(market.customerConcentration.top5SharePercent).toBe("100.00");
    expect(market.productMix.details[0]!.sharePercent).toBe("100.00");
    expect(market.channelMix.details[0]!.agentCode).toBe("A001");
    expect(market.channelMix.details[0]!.customers).toBe(2);
  });

  test("ลูกค้าใหม่ในเดือนล่าสุดนับจากการซื้อครั้งแรก", async () => {
    await billFor("ลูกค้าใหม่", [
      { prizeTypeId: f.prizeTypes.threeTop.id, number: "123", stake: "100" },
    ]);
    const market = await buildMarketInsight(f.actors.OWNER);
    expect(market.growth.newCustomersLatestMonth).toBe(1);
    expect(market.growth.latestMonthSales).toBe("100.00");
    // มีเดือนเดียว จึงเทียบไม่ได้
    expect(market.growth.changePercent).toBeNull();
  });

  test("ไม่มีข้อมูลเลยก็ไม่ล้มและไม่หารด้วยศูนย์", async () => {
    const market = await buildMarketInsight(f.actors.OWNER);
    expect(market.customerConcentration.totalCustomers).toBe(0);
    expect(market.customerConcentration.top5SharePercent).toBe("0.00");
    expect(market.productMix.details).toEqual([]);
  });
});

describe("ลูกค้าที่ซื้อเลขเดียวกันซ้ำ", () => {
  test("นับข้ามบิล เพราะกฎตรวจบิลห้ามเลขซ้ำในใบเดียวกัน", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor("ตอกเลขเดิม", [{ prizeTypeId: threeTop.id, number: "123", stake: "100" }]);
    await billFor("ตอกเลขเดิม", [{ prizeTypeId: threeTop.id, number: "123", stake: "50" }]);
    await billFor("ตอกเลขเดิม", [{ prizeTypeId: threeTop.id, number: "123", stake: "25" }]);
    await billFor("ซื้อครั้งเดียว", [{ prizeTypeId: threeTop.id, number: "456", stake: "500" }]);

    const result = await runQueryTool(f.actors.OWNER, "customer_number_repeat", {});
    if (!("rows" in result)) throw new Error("expected rows");

    // ซื้อครั้งเดียวไม่เข้าเกณฑ์ซ้ำ แม้ยอดจะสูงกว่า
    expect(result.rowCount).toBe(1);
    expect(result.rows[0]).toMatchObject({
      customerReference: "ตอกเลขเดิม",
      number: "123",
      repeatedItems: 3,
      totalStakeOnNumber: "175.00",
      billsInvolved: 3,
      drawsInvolved: 1,
    });
  });

  test("เลขเดียวกันคนละประเภทรางวัลก็นับเป็นซ้ำ", async () => {
    const { threeTop, threeTod } = f.prizeTypes;
    // ในบิลใบเดียวกันได้ เพราะคนละประเภทรางวัลจึงไม่ชนกฎเลขซ้ำ
    await billFor("เล่นทั้งบนทั้งโต๊ด", [
      { prizeTypeId: threeTop.id, number: "123", stake: "100" },
      { prizeTypeId: threeTod.id, number: "123", stake: "40" },
    ]);

    const result = await runQueryTool(f.actors.OWNER, "customer_number_repeat", {});
    if (!("rows" in result)) throw new Error("expected rows");
    expect(result.rows[0]).toMatchObject({
      customerReference: "เล่นทั้งบนทั้งโต๊ด",
      number: "123",
      repeatedItems: 2,
      totalStakeOnNumber: "140.00",
      billsInvolved: 1,
      prizeTypesInvolved: 2,
    });
  });

  test("นับข้ามรอบ และ minItems ปรับเกณฑ์ได้", async () => {
    const { threeTop } = f.prizeTypes;
    const now = new Date();
    const second = await prisma.draw.create({
      data: {
        organizationId: f.org.id,
        name: "รอบสอง",
        opensAt: new Date(now.getTime() + 86_400_000),
        cutoffAt: new Date(now.getTime() + 90_000_000),
        status: "OPEN",
      },
    });

    await billFor("ขาประจำ", [{ prizeTypeId: threeTop.id, number: "777", stake: "100" }]);
    await billFor(
      "ขาประจำ",
      [{ prizeTypeId: threeTop.id, number: "777", stake: "200" }],
      second.id,
    );

    const relaxed = await runQueryTool(f.actors.OWNER, "customer_number_repeat", { minItems: 2 });
    if (!("rows" in relaxed)) throw new Error("expected rows");
    expect(relaxed.rows[0]).toMatchObject({
      customerReference: "ขาประจำ",
      number: "777",
      repeatedItems: 2,
      totalStakeOnNumber: "300.00",
      drawsInvolved: 2,
    });

    const strict = await runQueryTool(f.actors.OWNER, "customer_number_repeat", { minItems: 3 });
    if (!("rows" in strict)) throw new Error("expected rows");
    expect(strict.rowCount).toBe(0);
    expect(strict.coverage).toContain("3 รายการ");
  });

  test("ยอดรวมของเลขนั้นไม่ใช่ยอดซื้อทั้งหมดของลูกค้า", async () => {
    const { threeTop } = f.prizeTypes;
    await billFor("ลูกค้า", [
      { prizeTypeId: threeTop.id, number: "111", stake: "10" },
      { prizeTypeId: threeTop.id, number: "222", stake: "9000" },
    ]);
    await billFor("ลูกค้า", [{ prizeTypeId: threeTop.id, number: "111", stake: "10" }]);

    const repeat = await runQueryTool(f.actors.OWNER, "customer_number_repeat", {});
    const ranking = await runQueryTool(f.actors.OWNER, "customer_ranking", {});
    if (!("rows" in repeat) || !("rows" in ranking)) throw new Error("expected rows");

    expect(repeat.rows[0]!.totalStakeOnNumber).toBe("20.00");
    expect(ranking.rows[0]!.totalSpend).toBe("9020.00");
  });
});

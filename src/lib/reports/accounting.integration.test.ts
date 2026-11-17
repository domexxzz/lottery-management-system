import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { placeBill } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { approveResult, enterResult } from "@/lib/results/service";
import { calculateSettlement } from "@/lib/settlement/service";
import { loadAccountingReport } from "./accounting";
import { parseAccountingQuery } from "./accounting-period";

let f: Fixtures;
beforeEach(async () => {
  f = await freshFixtures();
});

const bet = (prizeTypeId: string, number: string, stake: string) => ({ prizeTypeId, number, stake });
const thisMonth = () => parseAccountingQuery({});

describe("สรุปบัญชี", () => {
  test("งวดที่คำนวณแล้ว: ยอดขาย ถูกรางวัล จ่ายรางวัล ค่าคอมราย Agent ยอดสุทธิ และกำไร/ขาดทุน ตรงกับผลคำนวณ", async () => {
    const top = f.prizeTypes.threeTop.id;
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า ก", items: [bet(top, "123", "10"), bet(top, "456", "500")] });
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ลูกค้า ข", items: [bet(top, "123", "20")] });
    await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ลูกค้า ค", items: [bet(top, "789", "300")] });
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    for (const [prizeTypeId, value] of [[top, "123"], [f.prizeTypes.threeTod.id, "999"], [f.prizeTypes.runTop.id, "000"]] as const) {
      await enterResult(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId, value });
    }
    for (const draft of await prisma.result.findMany({ where: { drawId: f.draw.id, status: "DRAFT" } })) await approveResult(f.actors.ADMIN, draft.id);
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    const report = await loadAccountingReport(f.actors.OWNER, thisMonth());
    expect(report.draws).toHaveLength(1);
    const [draw] = report.draws;
    const settlements = await prisma.settlement.findMany({ where: { drawId: f.draw.id }, include: { agent: { select: { code: true } } } });
    const byCode = new Map(settlements.map((row) => [row.agent.code, row]));

    expect(draw!.settled).toBe(true);
    expect(draw!.gross).toBe(830);
    expect(draw!.payout).toBe(27000); // (10 + 20) × 900
    expect(draw!.winners).toBe(2); // ลูกค้า ก และ ข
    for (const line of draw!.agents) {
      const settlement = byCode.get(line.code)!;
      expect(line.commission).toBe(Number(settlement.commission));
      expect(line.estimated).toBe(false);
      expect(line.net).toBe(Number(settlement.gross) - Number(settlement.commission));
      // กำไร/ขาดทุน = ยอดสุทธิ − จ่ายรางวัล = net ของ Settlement
      expect(line.profit).toBe(Number(settlement.net));
    }
    expect(draw!.net).toBe(draw!.gross - draw!.commission);
    expect(draw!.profit).toBe(draw!.net - draw!.payout);
    expect(report.totals.profit).toBe(draw!.profit);
    expect(report.agents.map((agent) => agent.code)).toEqual(["A001", "A002"]);
  });

  test("งวดที่ยังไม่ออกผล: ค่าคอมประมาณจาก % ยอดสุทธิรู้ได้ แต่จ่ายรางวัลและกำไรยังรอผล", async () => {
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: [bet(f.prizeTypes.threeTop.id, "123", "100")] });
    const [draw] = (await loadAccountingReport(f.actors.OWNER, thisMonth())).draws;
    expect(draw).toMatchObject({ settled: false, gross: 100, commission: 25, estimated: true, net: 75, payout: 0, profit: null }); // A001 คอม 25%
  });

  test("กรอง Agent รายงวด และช่วงที่ไม่มีงวด", async () => {
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: [bet(f.prizeTypes.threeTop.id, "123", "100")] });
    await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ข", items: [bet(f.prizeTypes.threeTop.id, "124", "50")] });
    const onlyAgent2 = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ agentId: f.agents.agent2.id }));
    expect(onlyAgent2.totals.gross).toBe(50);
    const byDraw = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ period: "draw", drawId: f.draw.id }));
    expect(byDraw.totals.gross).toBe(150);
    const oldYear = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ period: "year", year: "2020" }));
    expect(oldYear.draws).toEqual([]);
    await expect(loadAccountingReport(f.actors.AGENT1, thisMonth())).rejects.toThrow();
  });
});

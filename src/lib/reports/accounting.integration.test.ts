import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { placeBill } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { approveResult, enterResult } from "@/lib/results/service";
import { calculateSettlement } from "@/lib/settlement/service";
import { loadAccountingReport } from "./accounting";
import { bangkokToday, parseAccountingQuery } from "./accounting-period";

let f: Fixtures;
beforeEach(async () => {
  f = await freshFixtures();
});

const bet = (prizeTypeId: string, number: string, stake: string) => ({ prizeTypeId, number, stake });
const thisMonth = () => parseAccountingQuery({ period: "current_month" });

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
    const byDraw = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ period: "current_draw" }));
    expect(byDraw.totals.gross).toBe(150);
    const oldYear = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ period: "previous_year" }));
    expect(oldYear.draws).toEqual([]);
    await expect(loadAccountingReport(f.actors.AGENT1, thisMonth())).rejects.toThrow();
  });

  test("กรองหลายประเภทหวยจากข้อมูลจริงและทำงานร่วมกับ Agent", async () => {
    const now = new Date();
    // ยึดวันออกผลเป็นวันนี้เวลาไทย ไม่ผูกกับ cutoff +1 ชั่วโมงซึ่งอาจข้ามวันเมื่อเทสใกล้เที่ยงคืน
    const drawDate = new Date(`${bangkokToday(now)}T00:00:00Z`);
    const laoFamilyId = `family-${Date.now()}-latest`;
    const previousFamilyId = `family-${Date.now()}-previous`;
    const [laoPrize, laoSetPrize, laoDraw, laoSetDraw] = await Promise.all([
      prisma.prizeType.create({ data: { organizationId: f.org.id, lotteryType: "LAO", code: 101, name: "3 ตัวบนลาว", digits: 3, matchRule: "EXACT", payoutRate: 650 } }),
      prisma.prizeType.create({ data: { organizationId: f.org.id, lotteryType: "LAO_SET", code: 201, name: "เลขชุด 4 ตัว", digits: 4, matchRule: "EXACT", payoutRate: 25500 } }),
      prisma.draw.create({ data: { organizationId: f.org.id, lotteryType: "LAO", laoFamilyId, name: "ลาวทดสอบ", drawDate, opensAt: new Date(now.getTime() - 3_600_000), cutoffAt: new Date(now.getTime() + 3_600_000), status: "OPEN" } }),
      prisma.draw.create({ data: { organizationId: f.org.id, lotteryType: "LAO_SET", laoFamilyId, name: "ลาวชุดทดสอบ", drawDate, opensAt: new Date(now.getTime() - 3_600_000), cutoffAt: new Date(now.getTime() + 3_600_000), status: "OPEN" } }),
    ]);
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ไทย", items: [bet(f.prizeTypes.threeTop.id, "123", "100")] });
    await placeBill(f.actors.AGENT1, { drawId: laoDraw.id, title: "ลาว", items: [bet(laoPrize.id, "456", "200")] });
    await placeBill(f.actors.AGENT2, { drawId: laoSetDraw.id, title: "ลาวชุด", items: [bet(laoSetPrize.id, "1234", "30")] });

    const previousDraws = await Promise.all([
      prisma.draw.create({ data: { organizationId: f.org.id, lotteryType: "THAI_GOVERNMENT", name: "ไทยงวดก่อน", drawDate, opensAt: new Date(now.getTime() - 3_600_000), cutoffAt: new Date(now.getTime() + 1_800_000), status: "OPEN" } }),
      prisma.draw.create({ data: { organizationId: f.org.id, lotteryType: "LAO", laoFamilyId: previousFamilyId, name: "ลาวงวดก่อน", drawDate, opensAt: new Date(now.getTime() - 3_600_000), cutoffAt: new Date(now.getTime() + 1_800_000), status: "OPEN" } }),
      prisma.draw.create({ data: { organizationId: f.org.id, lotteryType: "LAO_SET", laoFamilyId: previousFamilyId, name: "ลาวชุดงวดก่อน", drawDate, opensAt: new Date(now.getTime() - 3_600_000), cutoffAt: new Date(now.getTime() + 1_800_000), status: "OPEN" } }),
    ]);
    await placeBill(f.actors.AGENT1, { drawId: previousDraws[0]!.id, title: "ไทยก่อน", items: [bet(f.prizeTypes.threeTop.id, "111", "10")] });
    await placeBill(f.actors.AGENT1, { drawId: previousDraws[1]!.id, title: "ลาวก่อน", items: [bet(laoPrize.id, "222", "20")] });
    await placeBill(f.actors.AGENT2, { drawId: previousDraws[2]!.id, title: "ลาวชุดก่อน", items: [bet(laoSetPrize.id, "3333", "30")] });

    const thaiLao = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ lotteries: "THAI_GOVERNMENT,LAO" }));
    expect(thaiLao.draws.map((draw) => draw.category).sort()).toEqual(["LAO_COMBINED", "LAO_COMBINED", "THAI_GOVERNMENT", "THAI_GOVERNMENT"]);
    expect(thaiLao.totals).toMatchObject({ gross: 390, bills: 6, draws: 4 });

    const laoAndSet = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ lotteries: "LAO,LAO_SET" }));
    expect(laoAndSet.draws.map((draw) => draw.category)).toEqual(["LAO_COMBINED", "LAO_COMBINED"]);
    expect(laoAndSet.totals).toMatchObject({ gross: 280, bills: 4, draws: 2 });

    const onlySetAgent2 = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ lotteries: "LAO_SET", agentId: f.agents.agent2.id }));
    expect(onlySetAgent2.draws.map((draw) => draw.category)).toEqual(["LAO_COMBINED", "LAO_COMBINED"]);
    expect(onlySetAgent2.totals).toMatchObject({ gross: 60, bills: 2, draws: 2 });

    const setThisMonthAgent2 = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ period: "current_month", lotteries: "LAO_SET", agentId: f.agents.agent2.id }));
    expect(setThisMonthAgent2.draws.every((draw) => draw.category === "LAO_COMBINED")).toBe(true);
    expect(setThisMonthAgent2.totals).toMatchObject({ gross: 60, bills: 2, draws: 2 });

    const previous = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ period: "previous_draw" }));
    expect(new Set(previous.draws.map((draw) => draw.name))).toEqual(new Set(["ไทยงวดก่อน", "ลาวงวดก่อน"]));
    expect(previous.totals).toMatchObject({ gross: 60, bills: 3, draws: 2 });
  });
});

describe("สมการกำไรลงตัวเมื่อมีงวดรอผลปนอยู่", () => {
  test("ยอดขายที่คำนวณแล้ว − จ่ายรางวัล − ค่าคอมที่คำนวณแล้ว = กำไร และยอดรอผลแยกออกมา", async () => {
    const top = f.prizeTypes.threeTop.id;
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: [bet(top, "123", "10"), bet(top, "456", "500")] });
    await lockDrawManually(f.actors.ADMIN, f.draw.id);
    for (const [prizeTypeId, value] of [[top, "123"], [f.prizeTypes.threeTod.id, "999"], [f.prizeTypes.runTop.id, "000"]] as const) {
      await enterResult(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId, value });
    }
    for (const draft of await prisma.result.findMany({ where: { drawId: f.draw.id, status: "DRAFT" } })) await approveResult(f.actors.ADMIN, draft.id);
    await calculateSettlement(f.actors.ADMIN, f.draw.id);

    // งวดที่สองในเดือนเดียวกันยังเปิดรับ (รอผล)
    // วันออกผลเป็นวันนี้ (เวลาไทย) จึงอยู่ในช่วง "เดือนนี้" แน่นอน
    const pending = await prisma.draw.create({
      data: { organizationId: f.org.id, name: "งวดรอผล", drawDate: new Date(`${bangkokToday(new Date())}T00:00:00Z`), opensAt: new Date(Date.now() - 60_000), cutoffAt: new Date(Date.now() + 86_400_000) },
    });
    await placeBill(f.actors.AGENT2, { drawId: pending.id, title: "ข", items: [bet(top, "789", "200")] });

    const { totals } = await loadAccountingReport(f.actors.OWNER, thisMonth());
    expect(totals.draws).toBe(2);
    expect(totals.settledDraws).toBe(1);
    expect(totals.settledGross).toBe(510);
    expect(totals.pendingGross).toBe(200);
    expect(totals.gross).toBe(710);
    // สมการที่หน้าแสดงต้องลบกันลงตัว (เดิมใช้ยอดสุทธิที่รวมงวดรอผลจึงไม่ลงตัว)
    expect(Math.round((totals.settledGross - totals.payout - totals.settledCommission) * 100) / 100).toBe(totals.profit);
    expect(totals.net).not.toBe(Math.round((totals.settledGross - totals.settledCommission) * 100) / 100);
  });
});

describe("เปรียบเทียบรายงวด", () => {
  test("ดูเฉพาะงวดที่ระบุ ไม่ปนงวดอื่นในช่วงเวลาเดียวกัน", async () => {
    const top = f.prizeTypes.threeTop.id;
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: [bet(top, "123", "100")] });
    const other = await prisma.draw.create({
      data: { organizationId: f.org.id, name: "งวดอื่น", opensAt: new Date(Date.now() - 60_000), cutoffAt: new Date(Date.now() + 3_600_000) },
    });
    await placeBill(f.actors.AGENT1, { drawId: other.id, title: "ข", items: [bet(top, "456", "40")] });

    const onlyFirst = await loadAccountingReport(f.actors.OWNER, { ...thisMonth(), period: "custom", drawIds: [f.draw.id] });
    expect(onlyFirst.draws.map((draw) => draw.drawId)).toEqual([f.draw.id]);
    expect(onlyFirst.totals.gross).toBe(100);

    const onlyOther = await loadAccountingReport(f.actors.OWNER, { ...thisMonth(), period: "custom", drawIds: [other.id] });
    expect(onlyOther.totals.gross).toBe(40);
  });
});

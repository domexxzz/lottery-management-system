import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import { placeBill } from "@/lib/bills/service";
import { lockDrawManually } from "@/lib/draws/service";
import { approveResult, enterResult } from "@/lib/results/service";
import { calculateSettlement } from "@/lib/settlement/service";
import { defaultReportDraw, loadOwnerReport, parseReportLottery, type LotteryBreakdown } from "./owner-report";
import { loadAccountingReport } from "./accounting";
import { parseAccountingQuery } from "./accounting-period";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

const bet = (prizeTypeId: string, number: string, stake: string) => ({ prizeTypeId, number, stake });

/** ขายสองบิล แล้วลงผล 3 ตัวบน = 123 และคำนวณผล */
async function sellAndSettle() {
  const top = f.prizeTypes.threeTop.id;
  await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: [bet(top, "123", "10"), bet(top, "456", "500")] });
  await placeBill(f.actors.AGENT2, { drawId: f.draw.id, title: "ข", items: [bet(top, "789", "300")] });
  await lockDrawManually(f.actors.ADMIN, f.draw.id);
  await enterResult(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId: top, value: "123" });
  // ลงผลประเภทอื่นให้ครบเพื่อคำนวณได้
  await enterResult(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId: f.prizeTypes.threeTod.id, value: "999" });
  await enterResult(f.actors.ADMIN, { drawId: f.draw.id, prizeTypeId: f.prizeTypes.runTop.id, value: "000" });
  for (const draft of await prisma.result.findMany({ where: { drawId: f.draw.id, status: "DRAFT" } })) {
    await approveResult(f.actors.ADMIN, draft.id);
  }
  await calculateSettlement(f.actors.ADMIN, f.draw.id);
}

describe("รายงาน Owner", () => {
  test("ตัวเลขตรงกับผลคำนวณปิดงวด และสมการ ยอดขาย − จ่าย − คอม = กำไร", async () => {
    await sellAndSettle();
    const report = await loadOwnerReport(f.actors.OWNER, f.draw.id);
    expect(report).not.toBeNull();
    const selected = report!.selected!;

    const settlements = await prisma.settlement.aggregate({
      where: { drawId: f.draw.id },
      _sum: { gross: true, payout: true, commission: true, net: true },
    });
    expect(selected.draw.id).toBe(f.draw.id);
    expect(selected.settled).toBe(true);
    expect(selected.gross.toFixed(2)).toBe(settlements._sum.gross?.toFixed(2));
    expect(selected.payout.toFixed(2)).toBe(settlements._sum.payout?.toFixed(2));
    expect(selected.commission.toFixed(2)).toBe(settlements._sum.commission?.toFixed(2));
    expect(selected.net.toFixed(2)).toBe(settlements._sum.net?.toFixed(2));
    expect(selected.gross.minus(selected.payout).minus(selected.commission).toFixed(2)).toBe(selected.net.toFixed(2));
    expect(selected.gross.toFixed(2)).toBe("810.00");
    expect(selected.payout.toFixed(2)).toBe("9000.00"); // 10 × 900
    expect(selected.billCount).toBe(2);
    expect(selected.agentCount).toBe(2);

    // Agent เรียงจากยอดขายมากสุด และรวมกันเท่ายอดของงวด
    expect(report!.agents.map((agent) => agent.code)).toEqual(["A001", "A002"]);
    expect(report!.agentTotal).toBe(2);
    const agentNet = report!.agents.reduce((sum, agent) => sum.plus(agent.net), selected.net.minus(selected.net));
    expect(agentNet.toFixed(2)).toBe(selected.net.toFixed(2));

    // ประเภทรางวัลเรียงจากจ่ายมากสุด
    expect(report!.prizes[0]).toMatchObject({ name: f.prizeTypes.threeTop.name, itemCount: 3, winnerCount: 1 });
    expect(report!.prizes[0]!.payout.toFixed(2)).toBe("9000.00");

  });

  test("งวดที่ยังไม่คำนวณ: บอกยอดขาย แต่ไม่แสดงกำไรปลอม", async () => {
    await placeBill(f.actors.AGENT1, { drawId: f.draw.id, title: "ก", items: [bet(f.prizeTypes.threeTop.id, "123", "100")] });
    const report = await loadOwnerReport(f.actors.ADMIN, f.draw.id);
    expect(report!.selected!).toMatchObject({ settled: false });
    expect(report!.selected!.gross.toFixed(2)).toBe("100.00");
    expect(report!.selected!.net.toFixed(2)).toBe("0.00");
    expect(report!.selected!.commission.toFixed(2)).toBe("0.00");
  });

  test("แนวโน้มเรียงเก่าไปใหม่ จบที่งวดที่เลือก และไม่เกิน 12 งวด", async () => {
    const base = f.draw.cutoffAt.getTime();
    for (let index = 1; index <= 14; index += 1) {
      await prisma.draw.create({
        data: { organizationId: f.org.id, name: `งวดเก่า ${index}`, opensAt: new Date(base - index * 86_400_000 * 15 - 3600_000), cutoffAt: new Date(base - index * 86_400_000 * 15), status: "CLOSED" },
      });
    }
    const report = await loadOwnerReport(f.actors.OWNER, f.draw.id);
    expect(report!.trend).toHaveLength(12);
    expect(report!.trend.at(-1)!.draw.id).toBe(f.draw.id);
    const times = report!.trend.map((row) => row.draw.cutoffAt.getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(report!.previous?.draw.name).toBe("งวดเก่า 1");
  });

  test("ทุกงวด: ยอดขายรวมทุกงวด แต่กำไร จ่าย และคอม นับเฉพาะงวดที่คำนวณแล้ว", async () => {
    await sellAndSettle();
    const open = await prisma.draw.create({
      data: { organizationId: f.org.id, name: "งวดใหม่", opensAt: new Date(Date.now() - 60_000), cutoffAt: new Date(Date.now() + 86_400_000) },
    });
    await placeBill(f.actors.AGENT1, { drawId: open.id, title: "ค", items: [bet(f.prizeTypes.threeTop.id, "111", "100")] });

    const report = await loadOwnerReport(f.actors.OWNER, "all");
    const settled = await prisma.settlement.aggregate({ _sum: { net: true, commission: true } });
    expect(report!.selected).toBeNull();
    const all = report!.all!;
    expect(all.drawCount).toBe(2);
    expect(all.settledCount).toBe(1);
    expect(all.gross.toFixed(2)).toBe("910.00");
    expect(all.settledGross.toFixed(2)).toBe("810.00");
    expect(all.payout.toFixed(2)).toBe("9000.00");
    expect(all.net.toFixed(2)).toBe(settled._sum.net?.toFixed(2));
    expect(all.commission.toFixed(2)).toBe(settled._sum.commission?.toFixed(2));
    // สมการลงตัวด้วยยอดขายของงวดที่คำนวณแล้ว
    expect(all.settledGross.minus(all.payout).minus(all.commission).toFixed(2)).toBe(all.net.toFixed(2));
    expect(all.billCount).toBe(3);

    // Agent รวมทุกงวด: A001 ขาย 510 + 100 · กำไรรวมเท่ายอดรวม
    expect(report!.agents[0]).toMatchObject({ code: "A001" });
    expect(report!.agents[0]!.gross.toFixed(2)).toBe("610.00");
    const agentNet = report!.agents.reduce((sum, agent) => sum.plus(agent.net), all.net.minus(all.net));
    expect(agentNet.toFixed(2)).toBe(all.net.toFixed(2));

    // ประเภทการแทง: ยอดขายรวมทุกงวด ส่วนยอดที่ใช้หาเงินเหลือนับเฉพาะงวดที่คำนวณแล้ว
    const top = report!.prizes.find((prize) => prize.name === f.prizeTypes.threeTop.name)!;
    expect(top.gross.toFixed(2)).toBe("910.00");
    expect(top.settledGross.toFixed(2)).toBe("810.00");
  });

  test("เลือกได้หลายประเภทหวย: รวมเฉพาะประเภทที่เลือก ตารางแยกประเภทมีเฉพาะที่เลือก", async () => {
    await sellAndSettle();
    await prisma.draw.create({
      data: { organizationId: f.org.id, lotteryType: "LAO", name: "หวยลาว", opensAt: new Date(Date.now() - 60_000), cutoffAt: new Date(Date.now() + 60_000) },
    });
    expect(parseReportLottery("LAO_SET,THAI_GOVERNMENT")).toEqual(["THAI_GOVERNMENT", "LAO", "LAO_SET"]);
    expect(parseReportLottery("x")).toEqual(["THAI_GOVERNMENT", "LAO", "LAO_SET"]);

    const thaiLao = await loadOwnerReport(f.actors.OWNER, "all", "THAI_GOVERNMENT,LAO");
    expect(thaiLao!.lotteries).toEqual(["THAI_GOVERNMENT", "LAO", "LAO_SET"]);
    expect(thaiLao!.all!.drawCount).toBe(2);
    expect(thaiLao!.all!.gross.toFixed(2)).toBe("810.00");
    expect(thaiLao!.breakdown.map((row) => row.lotteryType)).toEqual(["THAI_GOVERNMENT", "LAO_COMBINED"]);

    const laoOnly = await loadOwnerReport(f.actors.OWNER, "all", "LAO");
    expect(laoOnly!.all!.drawCount).toBe(1);
    expect(laoOnly!.all!.gross.toFixed(2)).toBe("0.00");
    expect(laoOnly!.agents).toHaveLength(0);
    expect(laoOnly!.breakdown.map((row) => row.lotteryType)).toEqual(["LAO_COMBINED"]);
  });

  test("Agent เปิดรายงานภาพรวมไม่ได้", async () => {
    await expect(loadOwnerReport(f.actors.AGENT1)).rejects.toThrow();
  });
});

describe("กติกาเล็ก ๆ ของรายงาน", () => {
  test("งวดเริ่มต้นคืองวดล่าสุดที่คำนวณแล้ว", () => {
    const draws = [{ id: "open", status: "OPEN" as const }, { id: "done", status: "CLOSED" as const }];
    expect(defaultReportDraw(draws)?.id).toBe("done");
    expect(defaultReportDraw([{ id: "open", status: "OPEN" as const }])?.id).toBe("open");
  });
});

describe("ผู้ถูกรางวัลและตาราง 30 วัน", () => {
  test("สรุปผู้ถูกรางวัล: จำนวนบิล รายการ ลูกค้า และบิลที่ได้มากสุด", async () => {
    await sellAndSettle();
    const report = await loadOwnerReport(f.actors.OWNER, f.draw.id);
    expect(report!.winners).toMatchObject({ billCount: 1, itemCount: 1, customerCount: 1 });
    expect(report!.winners.payout.toFixed(2)).toBe("9000.00");
    expect(report!.winners.top[0]).toMatchObject({ customer: "ก", agentCode: "A001", winningItems: 1 });
  });

  test("ตาราง 30 วันแยกยอดขายที่คำนวณแล้วจากยอดรอผล สมการลงตัว", async () => {
    await sellAndSettle();
    // เลื่อนเวลาปิดรับของงวดทดสอบให้อยู่ในอดีต (ตาราง 30 วันนับตามวันออกผล เหมือนสรุปบัญชี)
    await prisma.draw.update({ where: { id: f.draw.id }, data: { cutoffAt: new Date(Date.now() - 5_000) } });
    const open = await prisma.draw.create({
      data: { organizationId: f.org.id, name: "งวดรอผล", opensAt: new Date(Date.now() - 3_600_000), cutoffAt: new Date(Date.now() + 86_400_000) },
    });
    await placeBill(f.actors.AGENT1, { drawId: open.id, title: "ค", items: [bet(f.prizeTypes.threeTop.id, "111", "100")] });
    await prisma.draw.update({ where: { id: open.id }, data: { cutoffAt: new Date(Date.now() - 1_000) } });

    const report = await loadOwnerReport(f.actors.OWNER);
    const thai = report!.breakdown.find((row) => row.lotteryType === "THAI_GOVERNMENT")!;
    expect(thai.settledGross.toFixed(2)).toBe("810.00");
    expect(thai.gross.minus(thai.settledGross).toFixed(2)).toBe("100.00");
    expect(thai.settledGross.minus(thai.payout).minus(thai.commission).toFixed(2)).toBe(thai.net.toFixed(2));
  });

  test("ลิงก์ไปสรุปบัญชีใช้ช่วงเดียวกับตาราง 30 วัน ยอดตรงกัน (รวมงวดที่ยังเปิดรับวันนี้)", async () => {
    await sellAndSettle();
    // งวดที่ยังเปิดรับ ออกผลวันนี้ สรุปบัญชีนับเป็นยอดรอผล ตาราง 30 วันต้องนับด้วย
    const open = await prisma.draw.create({
      data: { organizationId: f.org.id, name: "งวดเปิดรับ", opensAt: new Date(Date.now() - 3_600_000), cutoffAt: new Date(Date.now() + 60_000) },
    });
    await placeBill(f.actors.AGENT1, { drawId: open.id, title: "ค", items: [bet(f.prizeTypes.threeTop.id, "111", "100")] });

    const report = await loadOwnerReport(f.actors.OWNER);
    const { from, to } = report!.breakdownRange;
    const accounting = await loadAccountingReport(f.actors.OWNER, parseAccountingQuery({ period: "custom", from, to }));
    const sum = (pick: (row: LotteryBreakdown) => { toNumber(): number }) =>
      report!.breakdown.reduce((total, row) => total + pick(row).toNumber(), 0);
    expect(sum((row) => row.gross)).toBe(accounting.totals.gross);
    expect(sum((row) => row.settledGross)).toBe(accounting.totals.settledGross);
    expect(sum((row) => row.payout)).toBe(accounting.totals.payout);
    expect(sum((row) => row.net)).toBe(accounting.totals.profit);
  });
});

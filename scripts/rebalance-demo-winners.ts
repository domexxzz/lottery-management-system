import "dotenv/config";
import { prisma } from "../src/lib/db";
import { isWinning } from "../src/lib/results/matching";

const ORGANIZATION_ID = "seed-org";
const DEMO_DRAW_PREFIX = "งวดทดสอบ";
const DEMO_CUSTOMER_PREFIX = "ลูกค้าทดสอบ";

function winningNumber(result: string, digits: number, matchRule: string): string {
  if (matchRule === "CONTAINS_DIGIT") return result.slice(0, 1);
  const candidate = result.slice(0, digits);
  return matchRule === "PERMUTATION" ? [...candidate].reverse().join("") : candidate;
}

function stableSeed(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function losingNumber(
  result: string,
  digits: number,
  matchRule: "EXACT" | "PERMUTATION" | "CONTAINS_DIGIT",
  seed: number,
): string {
  const limit = 10 ** digits;
  const start = seed % limit;
  for (let offset = 0; offset < limit; offset += 1) {
    const value = (start + offset) % limit;
    const candidate = String(value).padStart(digits, "0");
    if (!isWinning({ number: candidate, resultValue: result, matchRule })) return candidate;
  }
  throw new Error(`ไม่สามารถสร้างเลขที่ไม่ถูกรางวัลสำหรับผล ${result}`);
}

function money(value: number): string {
  return value.toFixed(2);
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("สคริปต์ข้อมูลทดสอบห้ามทำงานใน Production");
  }

  const [draws, customers, agents] = await Promise.all([
    prisma.draw.findMany({
      where: { organizationId: ORGANIZATION_ID, name: { startsWith: DEMO_DRAW_PREFIX } },
      orderBy: { cutoffAt: "asc" },
      select: {
        id: true,
        name: true,
        bills: {
          where: { title: { startsWith: DEMO_CUSTOMER_PREFIX } },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            title: true,
            agentId: true,
            totalStake: true,
            items: {
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                stake: true,
                payoutRateSnapshot: true,
                prizeTypeId: true,
                prizeType: { select: { digits: true, matchRule: true } },
              },
            },
          },
        },
        results: {
          where: { status: "APPROVED" },
          orderBy: { version: "desc" },
          select: { prizeTypeId: true, value: true },
        },
      },
    }),
    prisma.bill.findMany({
      where: { organizationId: ORGANIZATION_ID, title: { startsWith: DEMO_CUSTOMER_PREFIX } },
      select: { title: true },
      distinct: ["title"],
      orderBy: { title: "asc" },
    }),
    prisma.agent.findMany({
      where: { organizationId: ORGANIZATION_ID },
      select: { id: true, commissionRate: true },
    }),
  ]);

  if (customers.length === 0 || draws.length === 0) throw new Error("ไม่พบข้อมูลทดสอบย้อนหลัง");
  const winnerCount = Math.round(customers.length * 0.02);
  const winnerNames = new Set(
    customers.filter((_, index) => index % 50 === 0).slice(0, winnerCount).map((row) => row.title),
  );
  const preferredWinningItem = new Map<string, { id: string; payout: number }>();
  for (const draw of draws) {
    for (const bill of draw.bills) {
      if (!winnerNames.has(bill.title)) continue;
      for (const item of bill.items) {
        const payout = Number(item.stake) * Number(item.payoutRateSnapshot);
        const current = preferredWinningItem.get(bill.title);
        if (!current || payout < current.payout) {
          preferredWinningItem.set(bill.title, { id: item.id, payout });
        }
      }
    }
  }
  if (preferredWinningItem.size !== winnerNames.size) {
    throw new Error("ไม่พบรายการสำหรับลูกค้าที่เลือกเป็นผู้ถูกรางวัลครบทุกคน");
  }
  let updatedItems = 0;

  for (const draw of draws) {
    const resultByPrizeType = new Map<string, string>();
    for (const result of draw.results) {
      if (!resultByPrizeType.has(result.prizeTypeId)) resultByPrizeType.set(result.prizeTypeId, result.value);
    }

    await prisma.$transaction(async (tx) => {
      const settlementTotals = new Map<string, { gross: number; payout: number }>();

      for (const bill of draw.bills) {
        let billPayout = 0;
        for (const item of bill.items) {
          const resultValue = resultByPrizeType.get(item.prizeTypeId);
          if (!resultValue) throw new Error(`ไม่พบผลรางวัลของ ${item.prizeTypeId} ใน ${draw.name}`);
          const shouldWin = preferredWinningItem.get(bill.title)?.id === item.id;
          const number = shouldWin
            ? winningNumber(resultValue, item.prizeType.digits, item.prizeType.matchRule)
            : losingNumber(
                resultValue,
                item.prizeType.digits,
                item.prizeType.matchRule,
                stableSeed(item.id),
              );
          const payout = shouldWin ? Number(item.stake) * Number(item.payoutRateSnapshot) : 0;
          await tx.billItem.update({
            where: { id: item.id },
            data: { number, isWinner: shouldWin, payout: money(payout) },
          });
          billPayout += payout;
          updatedItems += 1;
        }

        await tx.bill.update({ where: { id: bill.id }, data: { totalPayout: money(billPayout) } });
        const totals = settlementTotals.get(bill.agentId) ?? { gross: 0, payout: 0 };
        totals.gross += Number(bill.totalStake);
        totals.payout += billPayout;
        settlementTotals.set(bill.agentId, totals);
      }

      for (const agent of agents) {
        const totals = settlementTotals.get(agent.id);
        if (!totals) continue;
        const commission = totals.gross * Number(agent.commissionRate) / 100;
        await tx.settlement.update({
          where: { drawId_agentId: { drawId: draw.id, agentId: agent.id } },
          data: {
            gross: money(totals.gross),
            payout: money(totals.payout),
            commission: money(commission),
            net: money(totals.gross - totals.payout - commission),
          },
        });
      }
    }, { timeout: 30_000 });
  }

  const [actualWinners, demoTotals] = await Promise.all([
    prisma.bill.findMany({
      where: {
        organizationId: ORGANIZATION_ID,
        title: { startsWith: DEMO_CUSTOMER_PREFIX },
        items: { some: { isWinner: true } },
      },
      select: { title: true },
      distinct: ["title"],
    }),
    prisma.bill.aggregate({
      where: { organizationId: ORGANIZATION_ID, title: { startsWith: DEMO_CUSTOMER_PREFIX } },
      _sum: { totalStake: true, totalPayout: true },
    }),
  ]);
  const sales = Number(demoTotals._sum.totalStake ?? 0);
  const payout = Number(demoTotals._sum.totalPayout ?? 0);
  const salesToPayoutRatio = payout > 0 ? sales / payout : null;
  if (actualWinners.length !== winnerCount) {
    throw new Error(`ผู้ถูกรางวัลไม่ตรงเป้า: ต้องเป็น ${winnerCount} แต่พบ ${actualWinners.length}`);
  }
  if (salesToPayoutRatio !== null && salesToPayoutRatio < 5) {
    throw new Error(`ยอดขายต้องมากกว่ายอดจ่ายอย่างน้อย 5 เท่า แต่ปัจจุบัน ${salesToPayoutRatio.toFixed(2)} เท่า`);
  }

  console.log(JSON.stringify({
    customers: customers.length,
    winners: actualWinners.length,
    winnerRatePercent: Number((actualWinners.length / customers.length * 100).toFixed(2)),
    sales: money(sales),
    payout: money(payout),
    salesToPayoutRatio: salesToPayoutRatio === null ? null : Number(salesToPayoutRatio.toFixed(2)),
    updatedItems,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

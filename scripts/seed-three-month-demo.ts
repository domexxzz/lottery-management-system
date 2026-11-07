import "dotenv/config";
import { hashPassword } from "../src/lib/auth/password";
import { prisma } from "../src/lib/db";
import { isWinning } from "../src/lib/results/matching";

const ORGANIZATION_ID = "seed-org";
const BILLS_PER_AGENT_PER_DRAW = 5;
const CUSTOMERS_PER_AGENT = 15;

const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;
const HISTORICAL_DRAWS = Array.from({ length: 12 }, (_, monthOffset) => {
  const base = new Date(Date.UTC(2025, 10 + monthOffset, 1, 8));
  return [1, 16].map((day) => {
    const cutoffAt = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), day, 8));
    return {
      name: `งวดทดสอบ ${day} ${THAI_MONTHS[cutoffAt.getUTCMonth()]} ${cutoffAt.getUTCFullYear() + 543}`,
      cutoffAt,
    };
  });
}).flat();

const EXTRA_AGENTS = [
  { code: "A004", login: "agent4", name: "ตัวแทน ขอนแก่น", commissionRate: "21.0000", creditLimit: "350000.00" },
  { code: "A005", login: "agent5", name: "ตัวแทน นครราชสีมา", commissionRate: "20.5000", creditLimit: "400000.00" },
  { code: "A006", login: "agent6", name: "ตัวแทน อุดรธานี", commissionRate: "19.5000", creditLimit: "300000.00" },
  { code: "A007", login: "agent7", name: "ตัวแทน ภูเก็ต", commissionRate: "23.0000", creditLimit: "450000.00" },
  { code: "A008", login: "agent8", name: "ตัวแทน ชลบุรี", commissionRate: "22.0000", creditLimit: "380000.00" },
  { code: "A009", login: "agent9", name: "ตัวแทน สุราษฎร์ธานี", commissionRate: "20.0000", creditLimit: null },
  { code: "A010", login: "agent10", name: "ตัวแทน นครสวรรค์", commissionRate: "21.5000", creditLimit: "320000.00" },
] as const;

function seededNumber(seed: number, digits: number): string {
  let value = seed >>> 0;
  let output = "";
  for (let index = 0; index < digits; index += 1) {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    output += String(value % 10);
  }
  return output;
}

function winningNumber(result: string, digits: number, matchRule: string): string {
  if (matchRule === "CONTAINS_DIGIT") return result.slice(0, 1);
  const candidate = result.slice(0, digits);
  return matchRule === "PERMUTATION" ? [...candidate].reverse().join("") : candidate;
}

function losingNumber(result: string, digits: number, matchRule: string, seed: number): string {
  const limit = 10 ** digits;
  const start = Math.abs(seed) % limit;
  for (let offset = 0; offset < limit; offset += 1) {
    const value = (start + offset) % limit;
    const candidate = String(value).padStart(digits, "0");
    if (!isWinning({ number: candidate, resultValue: result, matchRule: matchRule as "EXACT" | "PERMUTATION" | "CONTAINS_DIGIT" })) {
      return candidate;
    }
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
  const seedPassword = process.env.SEED_PASSWORD;
  if (!seedPassword) throw new Error("กรุณาตั้ง SEED_PASSWORD ใน .env ก่อนรันสคริปต์");

  const organization = await prisma.organization.findUnique({ where: { id: ORGANIZATION_ID } });
  if (!organization) throw new Error("ไม่พบ seed-org กรุณารัน npm run db:seed ก่อน");

  const passwordHash = await hashPassword(seedPassword);
  const mustChangePassword = process.env.SEED_MUST_CHANGE_PASSWORD !== "false";

  for (const item of EXTRA_AGENTS) {
    const user = await prisma.user.upsert({
      where: { organizationId_login: { organizationId: ORGANIZATION_ID, login: item.login } },
      update: {
        displayName: item.name,
        role: "AGENT",
        status: "ACTIVE",
      },
      create: {
        organizationId: ORGANIZATION_ID,
        login: item.login,
        displayName: item.name,
        passwordHash,
        role: "AGENT",
        status: "ACTIVE",
        mustChangePassword,
      },
    });
    await prisma.agent.upsert({
      where: { organizationId_code: { organizationId: ORGANIZATION_ID, code: item.code } },
      update: {
        name: item.name,
        commissionRate: item.commissionRate,
        creditLimit: item.creditLimit,
        userId: user.id,
        status: "ACTIVE",
      },
      create: {
        organizationId: ORGANIZATION_ID,
        code: item.code,
        name: item.name,
        commissionRate: item.commissionRate,
        creditLimit: item.creditLimit,
        userId: user.id,
      },
    });
  }

  const [agents, prizeTypes, owner, admin] = await Promise.all([
    prisma.agent.findMany({
      where: { organizationId: ORGANIZATION_ID, status: "ACTIVE", userId: { not: null } },
      orderBy: { code: "asc" },
      include: { user: { select: { id: true } } },
    }),
    prisma.prizeType.findMany({
      where: { organizationId: ORGANIZATION_ID, isActive: true },
      orderBy: { code: "asc" },
    }),
    prisma.user.findUniqueOrThrow({
      where: { organizationId_login: { organizationId: ORGANIZATION_ID, login: "owner" } },
    }),
    prisma.user.findUniqueOrThrow({
      where: { organizationId_login: { organizationId: ORGANIZATION_ID, login: "admin" } },
    }),
  ]);

  if (agents.length < 10) throw new Error(`ต้องมี Agent อย่างน้อย 10 คน แต่พบ ${agents.length} คน`);
  if (prizeTypes.length === 0) throw new Error("ไม่พบประเภทรางวัล");

  let createdDraws = 0;
  let createdBills = 0;
  let createdItems = 0;
  const customers = new Set<string>();

  for (const [drawIndex, drawSeed] of HISTORICAL_DRAWS.entries()) {
    const existing = await prisma.draw.findFirst({
      where: { organizationId: ORGANIZATION_ID, name: drawSeed.name },
      select: { id: true, _count: { select: { bills: true } } },
    });
    if (existing?._count.bills) continue;

    const plannedBills = agents.length * BILLS_PER_AGENT_PER_DRAW;
    const sequence = await prisma.organization.update({
      where: { id: ORGANIZATION_ID },
      data: { billSequence: { increment: plannedBills } },
      select: { billSequence: true },
    });
    const firstSequence = sequence.billSequence - plannedBills + 1;

    const resultByPrizeType = new Map(
      prizeTypes.map((prizeType, prizeIndex) => [
        prizeType.id,
        seededNumber((drawIndex + 1) * 10_000 + prizeIndex * 97, prizeType.resultDigits ?? prizeType.digits),
      ]),
    );

    const summary = await prisma.$transaction(async (tx) => {
      const opensAt = new Date(drawSeed.cutoffAt.getTime() - 14 * 24 * 60 * 60 * 1000);
      const draw = existing
        ? await tx.draw.update({
            where: { id: existing.id },
            data: {
              opensAt,
              cutoffAt: drawSeed.cutoffAt,
              status: "CLOSED",
              lockedAt: drawSeed.cutoffAt,
              closedAt: new Date(drawSeed.cutoffAt.getTime() + 8 * 60 * 60 * 1000),
            },
          })
        : await tx.draw.create({
            data: {
              organizationId: ORGANIZATION_ID,
              name: drawSeed.name,
              opensAt,
              cutoffAt: drawSeed.cutoffAt,
              status: "CLOSED",
              lockedAt: drawSeed.cutoffAt,
              closedAt: new Date(drawSeed.cutoffAt.getTime() + 8 * 60 * 60 * 1000),
            },
          });

      await tx.result.createMany({
        data: prizeTypes.map((prizeType) => ({
          organizationId: ORGANIZATION_ID,
          drawId: draw.id,
          prizeTypeId: prizeType.id,
          value: resultByPrizeType.get(prizeType.id)!,
          status: "APPROVED" as const,
          makerId: admin.id,
          checkerId: owner.id,
          enteredAt: new Date(drawSeed.cutoffAt.getTime() + 30 * 60 * 1000),
          checkedAt: new Date(drawSeed.cutoffAt.getTime() + 60 * 60 * 1000),
        })),
        skipDuplicates: true,
      });

      let billOffset = 0;
      let itemCount = 0;
      const settlementRows: Array<{
        agentId: string;
        gross: number;
        payout: number;
        commission: number;
        net: number;
        commissionRate: number;
      }> = [];

      for (const [agentIndex, agent] of agents.entries()) {
        let gross = 0;
        let payout = 0;
        for (let billIndex = 0; billIndex < BILLS_PER_AGENT_PER_DRAW; billIndex += 1) {
          const customerIndex = agentIndex * CUSTOMERS_PER_AGENT + ((drawIndex * BILLS_PER_AGENT_PER_DRAW + billIndex) % CUSTOMERS_PER_AGENT) + 1;
          const customer = `ลูกค้าทดสอบ ${String(customerIndex).padStart(3, "0")}`;
          customers.add(customer);
          const createdAt = new Date(opensAt.getTime() + ((agentIndex * 7 + billIndex + 1) % 12) * 24 * 60 * 60 * 1000);
          const items = [];
          const numberOfItems = 2 + ((drawIndex + agentIndex + billIndex) % 3);
          let billStake = 0;
          let billPayout = 0;

          for (let itemIndex = 0; itemIndex < numberOfItems; itemIndex += 1) {
            const prizeType = prizeTypes[(drawIndex * 3 + agentIndex + billIndex + itemIndex) % prizeTypes.length]!;
            const resultValue = resultByPrizeType.get(prizeType.id)!;
            // ลูกค้าทดสอบ 3 จาก 150 คนมีรางวัลอย่างน้อยหนึ่งรายการ = 2% พอดี
            const localCustomerOffset = (customerIndex - 1) % CUSTOMERS_PER_AGENT;
            const selectedWinner = (customerIndex - 1) % 50 === 0;
            const forceWinner = selectedWinner
              && drawIndex === Math.floor(localCustomerOffset / BILLS_PER_AGENT_PER_DRAW)
              && billIndex === localCustomerOffset % BILLS_PER_AGENT_PER_DRAW
              && itemIndex === 0;
            const number = forceWinner
              ? winningNumber(resultValue, prizeType.digits, prizeType.matchRule)
              : losingNumber(
                  resultValue,
                  prizeType.digits,
                  prizeType.matchRule,
                  (drawIndex + 1) * 100_000 + customerIndex * 101 + itemIndex * 17,
                );
            const stake = [20, 50, 100, 200, 500][(agentIndex + billIndex + itemIndex + drawIndex) % 5]!;
            const winner = isWinning({ number, resultValue, matchRule: prizeType.matchRule });
            const itemPayout = winner ? stake * Number(prizeType.payoutRate) : 0;
            billStake += stake;
            billPayout += itemPayout;
            items.push({
              organizationId: ORGANIZATION_ID,
              prizeTypeId: prizeType.id,
              number,
              stake: money(stake),
              payoutRateSnapshot: prizeType.payoutRate.toString(),
              isWinner: winner,
              payout: money(itemPayout),
              createdAt,
            });
          }

          await tx.bill.create({
            data: {
              organizationId: ORGANIZATION_ID,
              agentId: agent.id,
              drawId: draw.id,
              billNumber: String(firstSequence + billOffset).padStart(8, "0"),
              title: customer,
              status: "SETTLED",
              totalStake: money(billStake),
              totalPayout: money(billPayout),
              createdById: agent.user!.id,
              confirmedAt: new Date(createdAt.getTime() + 5 * 60 * 1000),
              createdAt,
              items: { create: items },
            },
          });
          billOffset += 1;
          itemCount += items.length;
          gross += billStake;
          payout += billPayout;
        }

        const commissionRate = Number(agent.commissionRate);
        const commission = gross * commissionRate / 100;
        settlementRows.push({
          agentId: agent.id,
          gross,
          payout,
          commission,
          net: gross - payout - commission,
          commissionRate,
        });
      }

      await tx.settlement.createMany({
        data: settlementRows.map((row) => ({
          organizationId: ORGANIZATION_ID,
          drawId: draw.id,
          agentId: row.agentId,
          gross: money(row.gross),
          payout: money(row.payout),
          commission: money(row.commission),
          net: money(row.net),
          commissionRateSnapshot: row.commissionRate.toFixed(4),
          status: "APPROVED" as const,
          calculatedAt: new Date(drawSeed.cutoffAt.getTime() + 2 * 60 * 60 * 1000),
          reconciledById: admin.id,
          reconciledAt: new Date(drawSeed.cutoffAt.getTime() + 3 * 60 * 60 * 1000),
          approvedById: owner.id,
          approvedAt: new Date(drawSeed.cutoffAt.getTime() + 4 * 60 * 60 * 1000),
        })),
        skipDuplicates: true,
      });

      await tx.auditEvent.create({
        data: {
          organizationId: ORGANIZATION_ID,
          actorId: owner.id,
          action: "CREATE",
          entityType: "DemoHistory",
          entityId: draw.id,
          after: { draw: drawSeed.name, bills: plannedBills, items: itemCount, agents: agents.length },
          reason: "สร้างข้อมูลทดสอบย้อนหลัง 1 ปี",
        },
      });

      return { bills: plannedBills, items: itemCount };
    }, { timeout: 60_000 });

    createdDraws += 1;
    createdBills += summary.bills;
    createdItems += summary.items;
  }

  const counts = await Promise.all([
    prisma.agent.count({ where: { organizationId: ORGANIZATION_ID } }),
    prisma.draw.count({ where: { organizationId: ORGANIZATION_ID } }),
    prisma.bill.count({ where: { organizationId: ORGANIZATION_ID } }),
    prisma.billItem.count({ where: { organizationId: ORGANIZATION_ID } }),
  ]);

  console.log(JSON.stringify({
    added: { draws: createdDraws, bills: createdBills, items: createdItems, customers: customers.size },
    totals: { agents: counts[0], draws: counts[1], bills: counts[2], items: counts[3] },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

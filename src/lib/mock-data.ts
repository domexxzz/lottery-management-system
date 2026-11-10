import { randomUUID } from "node:crypto";
import { Prisma, type MatchRule } from "@prisma/client";
import { databaseSchema, prisma } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { isWinning } from "@/lib/results/matching";
import { billSequencePeriod, buildInternalBillNumber } from "@/lib/bills/numbering";

export const MOCK_BILL_COUNT = 2_000;
const DRAW_COUNT = 24;
const DAY = 24 * 60 * 60 * 1_000;
const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;
const DRAW_DEMAND_WEIGHTS = [
  .62, .88, 1.16, .74, 1.42, 1.03, .69, 1.28, 1.67, .92, 1.34, .81,
  1.52, 1.08, .71, 1.39, .97, 1.78, .84, 1.21, 1.58, .76, 1.31, 1.91,
] as const;
const STAKE_LEVELS = [20, 30, 50, 80, 100, 150, 200, 300, 500, 750, 1_000] as const;

type ToggleActor = {
  userId: string;
  organizationId: string;
  requestId?: string;
  ipAddress?: string;
};

function dbTable(name: "organizations" | "draws" | "bills" | "agent_bill_counters") {
  const schema = databaseSchema().replaceAll('"', '""');
  return Prisma.raw(`"${schema}"."${name}"`);
}

async function transactionMockDataEnabled(tx: Prisma.TransactionClient, organizationId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ enabled: boolean }>>(Prisma.sql`
    SELECT "mockDataEnabled" AS enabled
    FROM ${dbTable("organizations")}
    WHERE id = ${organizationId}
  `);
  return rows[0]?.enabled ?? false;
}

function chunks<T>(rows: T[], size = 500): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < rows.length; index += size) output.push(rows.slice(index, index + size));
  return output;
}

function seededNumber(seed: number, digits: number): string {
  let value = seed >>> 0;
  let output = "";
  for (let index = 0; index < digits; index += 1) {
    value = (value * 1_664_525 + 1_013_904_223) >>> 0;
    output += String(value % 10);
  }
  return output;
}

function winningNumber(result: string, digits: number, matchRule: MatchRule): string {
  if (matchRule === "CONTAINS_DIGIT") return result.slice(0, 1);
  const candidate = result.slice(0, digits);
  return matchRule === "PERMUTATION" ? [...candidate].reverse().join("") : candidate;
}

function losingNumber(result: string, digits: number, matchRule: MatchRule, seed: number): string {
  const limit = 10 ** digits;
  const start = Math.abs(seed) % limit;
  for (let offset = 0; offset < limit; offset += 1) {
    const candidate = String((start + offset) % limit).padStart(digits, "0");
    if (!isWinning({ number: candidate, resultValue: result, matchRule })) return candidate;
  }
  throw new Error(`สร้างเลขจำลองที่ไม่ถูกรางวัลไม่ได้: ${result}`);
}

function money(value: number): string {
  return value.toFixed(2);
}

function distributeWeightedTotal(total: number, weights: readonly number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const raw = weights.map((weight) => total * weight / weightTotal);
  const counts = raw.map(Math.floor);
  let remaining = total - counts.reduce((sum, count) => sum + count, 0);
  const order = raw.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);
  for (const row of order) {
    if (remaining <= 0) break;
    counts[row.index] = (counts[row.index] ?? 0) + 1;
    remaining -= 1;
  }
  return counts;
}

function mockCustomerIndex(globalBillIndex: number, drawIndex: number): number {
  const segment = (globalBillIndex * 37 + drawIndex * 19) % 100;
  if (segment < 48) return 1 + ((globalBillIndex * 11 + drawIndex * 7) % 55);
  if (segment < 80) return 56 + ((globalBillIndex * 13 + drawIndex * 5) % 115);
  return 171 + ((globalBillIndex * 17 + drawIndex * 11) % 190);
}

function mockStake(globalBillIndex: number, drawIndex: number, itemIndex: number, customerIndex: number, agentIndex: number): number {
  const base = STAKE_LEVELS[(globalBillIndex * 3 + drawIndex * 5 + itemIndex * 7) % STAKE_LEVELS.length]!;
  const customerFactor = customerIndex <= 55 ? 1.55 : customerIndex <= 170 ? 1.05 : .7;
  const agentFactor = .82 + (agentIndex % 6) * .09;
  const pulse = .82 + ((globalBillIndex + itemIndex * 3 + drawIndex) % 8) * .06;
  const drawFactor = DRAW_DEMAND_WEIGHTS[drawIndex] ?? 1;
  return Math.max(10, Math.round(base * customerFactor * agentFactor * pulse * drawFactor / 10) * 10);
}

/** คืนงวดวันที่ 1 และ 16 จำนวน 24 งวดย้อนหลังไม่เกินหนึ่งปี */
function historicalDrawDates(now: Date): Date[] {
  const start = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const candidates: Date[] = [];
  for (let offset = -12; offset <= 0; offset += 1) {
    for (const day of [1, 16]) {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, day, 8, 0, 0));
      if (date >= start && date < now) candidates.push(date);
    }
  }
  return candidates.sort((left, right) => right.getTime() - left.getTime()).slice(0, DRAW_COUNT).reverse();
}

async function deleteMockRows(tx: Prisma.TransactionClient, organizationId: string): Promise<number> {
  // ใช้ raw query สำหรับคอลัมน์ใหม่ เพื่อให้ next dev ที่ยัง cache generated
  // Prisma Client รุ่นก่อน migration สามารถ hot-reload ต่อได้โดยไม่ล้ม
  const draws = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM ${dbTable("draws")}
    WHERE "organizationId" = ${organizationId} AND "isMock" = true
  `);
  const drawIds = draws.map((draw) => draw.id);
  if (drawIds.length === 0) return 0;

  await tx.settlement.deleteMany({ where: { organizationId, drawId: { in: drawIds } } });
  await tx.result.deleteMany({ where: { organizationId, drawId: { in: drawIds } } });
  const deletedBills = await tx.bill.deleteMany({ where: { organizationId, drawId: { in: drawIds } } });
  await rebuildAgentBillCounters(tx, organizationId);
  await tx.draw.deleteMany({ where: { organizationId, id: { in: drawIds } } });
  return deletedBills.count;
}

/** สร้างตัวนับใหม่จากบิลที่เหลือ ป้องกันข้อมูลจำลองกินเลขหรือทำเลขชนกับบิลจริง */
async function rebuildAgentBillCounters(tx: Prisma.TransactionClient, organizationId: string): Promise<void> {
  await tx.$executeRaw(Prisma.sql`
    DELETE FROM ${dbTable("agent_bill_counters")} WHERE "organizationId" = ${organizationId}
  `);
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO ${dbTable("agent_bill_counters")}
      ("organizationId", "agentId", "period", "lastSequence", "updatedAt")
    SELECT "organizationId", "agentId", "sequencePeriod", MAX("drawSequence"), CURRENT_TIMESTAMP
    FROM ${dbTable("bills")}
    WHERE "organizationId" = ${organizationId}
      AND "sequencePeriod" IS NOT NULL
      AND "drawSequence" IS NOT NULL
    GROUP BY "organizationId", "agentId", "sequencePeriod"
  `);
}

export async function isMockDataEnabled(organizationId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ enabled: boolean }>>(Prisma.sql`
    SELECT "mockDataEnabled" AS enabled
    FROM ${dbTable("organizations")}
    WHERE id = ${organizationId}
  `);
  return rows[0]?.enabled ?? false;
}

export async function mockDataStatus(organizationId: string): Promise<{ enabled: boolean; billCount: number }> {
  const rows = await prisma.$queryRaw<Array<{ enabled: boolean; billCount: bigint }>>(Prisma.sql`
    SELECT o."mockDataEnabled" AS enabled, count(b.id)::bigint AS "billCount"
    FROM ${dbTable("organizations")} o
    LEFT JOIN ${dbTable("draws")} d ON d."organizationId" = o.id AND d."isMock" = true
    LEFT JOIN ${dbTable("bills")} b ON b."drawId" = d.id
    WHERE o.id = ${organizationId}
    GROUP BY o."mockDataEnabled"
  `);
  return { enabled: rows[0]?.enabled ?? false, billCount: Number(rows[0]?.billCount ?? 0) };
}

export async function setMockDataEnabled(actor: ToggleActor, enabled: boolean): Promise<{ enabled: boolean; billCount: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.organization.findUniqueOrThrow({
      where: { id: actor.organizationId },
      select: { id: true },
    });
    const currentEnabled = await transactionMockDataEnabled(tx, actor.organizationId);

    if (currentEnabled === enabled) {
      const mockDraws = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM ${dbTable("draws")}
        WHERE "organizationId" = ${actor.organizationId} AND "isMock" = true
      `);
      const billCount = mockDraws.length
        ? await tx.bill.count({ where: { organizationId: actor.organizationId, drawId: { in: mockDraws.map((draw) => draw.id) } } })
        : 0;
      return { enabled, billCount };
    }

    if (!enabled) {
      const deletedBills = await deleteMockRows(tx, actor.organizationId);
      await tx.$executeRaw(Prisma.sql`
        UPDATE ${dbTable("organizations")} SET "mockDataEnabled" = false
        WHERE id = ${actor.organizationId}
      `);
      await tx.auditEvent.create({
        data: {
          organizationId: actor.organizationId,
          actorId: actor.userId,
          action: "UPDATE",
          entityType: "MockData",
          entityId: actor.organizationId,
          before: { enabled: true },
          after: { enabled: false, deletedBills },
          reason: "ปิดข้อมูลจำลองสำหรับผู้ใช้ทุกคน",
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
        },
      });
      return { enabled: false, billCount: 0 };
    }

    const [agents, prizeTypes, users] = await Promise.all([
      tx.agent.findMany({
        where: { organizationId: actor.organizationId, status: "ACTIVE" },
        orderBy: { code: "asc" },
        select: { id: true, code: true, userId: true, commissionRate: true },
      }),
      tx.prizeType.findMany({
        where: { organizationId: actor.organizationId, isActive: true },
        orderBy: { code: "asc" },
        select: { id: true, digits: true, resultDigits: true, matchRule: true, payoutRate: true },
      }),
      tx.user.findMany({
        where: { organizationId: actor.organizationId, role: { in: ["OWNER", "ADMIN"] }, status: "ACTIVE" },
        select: { id: true, role: true },
      }),
    ]);

    if (agents.length === 0 || prizeTypes.length === 0) {
      throw new ConflictError("ต้องมี Agent และประเภทรางวัลที่ใช้งานอยู่ก่อนเปิดข้อมูลจำลอง");
    }
    const ownerId = users.find((user) => user.role === "OWNER")?.id ?? actor.userId;
    const makerId = users.find((user) => user.role === "ADMIN")?.id ?? actor.userId;

    await deleteMockRows(tx, actor.organizationId);
    const drawDates = historicalDrawDates(new Date());
    if (drawDates.length !== DRAW_COUNT) throw new ConflictError("สร้างช่วงข้อมูลงวดย้อนหลังหนึ่งปีไม่สำเร็จ");
    const billsPerDraw = distributeWeightedTotal(MOCK_BILL_COUNT, DRAW_DEMAND_WEIGHTS);

    const draws = drawDates.map((cutoffAt, drawIndex) => ({
      id: randomUUID(),
      organizationId: actor.organizationId,
      name: `งวดจำลอง ${cutoffAt.getUTCDate()} ${THAI_MONTHS[cutoffAt.getUTCMonth()]} ${cutoffAt.getUTCFullYear() + 543}`,
      opensAt: new Date(cutoffAt.getTime() - 14 * DAY),
      cutoffAt,
      status: "CLOSED" as const,
      lockedAt: cutoffAt,
      closedAt: new Date(cutoffAt.getTime() + 8 * 60 * 60 * 1_000),
    }));
    await tx.draw.createMany({ data: draws });
    await tx.$executeRaw(Prisma.sql`
      UPDATE ${dbTable("draws")} SET "isMock" = true
      WHERE id IN (${Prisma.join(draws.map((draw) => draw.id))})
    `);

    const resultRows: Prisma.ResultCreateManyInput[] = [];
    const resultValues = new Map<string, string>();
    for (const [drawIndex, draw] of draws.entries()) {
      for (const [prizeIndex, prizeType] of prizeTypes.entries()) {
        const value = seededNumber((drawIndex + 1) * 10_000 + prizeIndex * 97, prizeType.resultDigits ?? prizeType.digits);
        resultValues.set(`${draw.id}:${prizeType.id}`, value);
        resultRows.push({
          id: randomUUID(),
          organizationId: actor.organizationId,
          drawId: draw.id,
          prizeTypeId: prizeType.id,
          value,
          values: [value],
          status: "APPROVED",
          makerId,
          checkerId: ownerId,
          enteredAt: new Date(draw.cutoffAt.getTime() + 30 * 60 * 1_000),
          checkedAt: new Date(draw.cutoffAt.getTime() + 60 * 60 * 1_000),
        });
      }
    }
    for (const batch of chunks(resultRows)) await tx.result.createMany({ data: batch });

    const billRows: Prisma.BillCreateManyInput[] = [];
    const itemRows: Prisma.BillItemCreateManyInput[] = [];
    const settlementTotals = new Map<string, { drawId: string; agentId: string; gross: number; payout: number; commissionRate: number }>();
    const existingCounters = await tx.agentBillCounter.findMany({
      where: { organizationId: actor.organizationId },
      select: { agentId: true, period: true, lastSequence: true },
    });
    const agentMonthSequences = new Map(existingCounters.map((row) => [`${row.agentId}:${row.period}`, row.lastSequence]));
    let globalBillIndex = 0;

    for (const [drawIndex, draw] of draws.entries()) {
      const billsThisDraw = billsPerDraw[drawIndex] ?? 0;
      for (let localBillIndex = 0; localBillIndex < billsThisDraw; localBillIndex += 1) {
        const agentIndex = (globalBillIndex + drawIndex * 3) % agents.length;
        const agent = agents[agentIndex]!;
        const customerIndex = mockCustomerIndex(globalBillIndex, drawIndex);
        const billId = randomUUID();
        const createdAt = new Date(draw.opensAt.getTime() + ((localBillIndex * 37 + drawIndex * 11) % 13_500) * 60 * 1_000);
        const itemCount = 1 + ((globalBillIndex * 7 + drawIndex * 3) % 5);
        const confirmedAt = new Date(createdAt.getTime() + 5 * 60 * 1_000);
        const sequencePeriod = billSequencePeriod(confirmedAt);
        const sequenceKey = `${agent.id}:${sequencePeriod}`;
        const drawSequence = (agentMonthSequences.get(sequenceKey) ?? 0) + 1;
        agentMonthSequences.set(sequenceKey, drawSequence);
        let totalStake = 0;
        let totalPayout = 0;

        for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
          const prizeType = prizeTypes[(globalBillIndex * 3 + drawIndex + itemIndex) % prizeTypes.length]!;
          const resultValue = resultValues.get(`${draw.id}:${prizeType.id}`)!;
          const forceWinner = globalBillIndex % 47 === 0 && itemIndex === 0;
          const number = forceWinner
            ? winningNumber(resultValue, prizeType.digits, prizeType.matchRule)
            : losingNumber(resultValue, prizeType.digits, prizeType.matchRule, globalBillIndex * 101 + itemIndex * 17);
          const stake = mockStake(globalBillIndex, drawIndex, itemIndex, customerIndex, agentIndex);
          const winner = isWinning({ number, resultValue, matchRule: prizeType.matchRule });
          const payout = winner ? stake * Number(prizeType.payoutRate) : 0;
          totalStake += stake;
          totalPayout += payout;
          itemRows.push({
            id: randomUUID(),
            organizationId: actor.organizationId,
            billId,
            prizeTypeId: prizeType.id,
            number,
            stake: money(stake),
            payoutRateSnapshot: prizeType.payoutRate.toString(),
            isWinner: winner,
            payout: money(payout),
            createdAt,
          });
        }

        billRows.push({
          id: billId,
          organizationId: actor.organizationId,
          agentId: agent.id,
          drawId: draw.id,
          billNumber: buildInternalBillNumber({
            agentCode: agent.code,
            lotteryType: "THAI_GOVERNMENT",
            issuedAt: confirmedAt,
            drawSequence,
          }),
          drawSequence,
          sequencePeriod,
          title: `ลูกค้าจำลอง ${String(customerIndex).padStart(3, "0")}`,
          status: "SETTLED",
          totalStake: money(totalStake),
          totalPayout: money(totalPayout),
          createdById: agent.userId ?? actor.userId,
          confirmedAt,
          createdAt,
        });

        const totalKey = `${draw.id}:${agent.id}`;
        const current = settlementTotals.get(totalKey) ?? {
          drawId: draw.id,
          agentId: agent.id,
          gross: 0,
          payout: 0,
          commissionRate: Number(agent.commissionRate),
        };
        current.gross += totalStake;
        current.payout += totalPayout;
        settlementTotals.set(totalKey, current);
        globalBillIndex += 1;
      }
    }

    for (const batch of chunks(billRows)) await tx.bill.createMany({ data: batch });
    for (const batch of chunks(itemRows)) await tx.billItem.createMany({ data: batch });
    await rebuildAgentBillCounters(tx, actor.organizationId);

    const settlementRows: Prisma.SettlementCreateManyInput[] = [...settlementTotals.values()].map((row) => {
      const commission = row.gross * row.commissionRate / 100;
      const draw = draws.find((candidate) => candidate.id === row.drawId)!;
      return {
        id: randomUUID(),
        organizationId: actor.organizationId,
        drawId: row.drawId,
        agentId: row.agentId,
        gross: money(row.gross),
        payout: money(row.payout),
        commission: money(commission),
        net: money(row.gross - row.payout - commission),
        commissionRateSnapshot: row.commissionRate.toFixed(4),
        status: "APPROVED",
        calculatedAt: new Date(draw.cutoffAt.getTime() + 2 * 60 * 60 * 1_000),
        reconciledById: makerId,
        reconciledAt: new Date(draw.cutoffAt.getTime() + 3 * 60 * 60 * 1_000),
        approvedById: ownerId,
        approvedAt: new Date(draw.cutoffAt.getTime() + 4 * 60 * 60 * 1_000),
      };
    });
    for (const batch of chunks(settlementRows)) await tx.settlement.createMany({ data: batch });

    await tx.$executeRaw(Prisma.sql`
      UPDATE ${dbTable("organizations")} SET "mockDataEnabled" = true
      WHERE id = ${actor.organizationId}
    `);
    await tx.auditEvent.create({
      data: {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: "UPDATE",
        entityType: "MockData",
        entityId: actor.organizationId,
        before: { enabled: false },
        after: { enabled: true, bills: billRows.length, items: itemRows.length, draws: draws.length },
        reason: "เปิดข้อมูลจำลองย้อนหลังหนึ่งปีสำหรับผู้ใช้ทุกคน",
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
      },
    });

    return { enabled: true, billCount: billRows.length };
  }, { isolationLevel: "Serializable", timeout: 120_000 });
}

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit, type TxClient } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { commissionOf, itemPayout, netOf, sumMoney, toMoney, ZERO } from "@/lib/money";
import { isWinning } from "@/lib/results/matching";

/**
 * คำนวณผู้ถูกรางวัลและสรุปการเงินต่อ Agent (LOT-15, LOT-18, LOT-20)
 *
 * คุณสมบัติที่ต้องรักษาไว้
 *
 * 1. คำนวณซ้ำได้ผลเดิม — อ่าน payoutRateSnapshot และ commissionRateSnapshot
 *    ไม่ใช่เรตปัจจุบัน จึงรันซ้ำกี่ครั้งก็ได้ผลเท่าเดิม
 *
 * 2. นับเฉพาะบิลที่มีผลผูกพัน — LOCKED และ SETTLED เท่านั้น
 *    บิลร่างและบิลที่ยกเลิกไม่ถูกนับ
 *
 * 3. ใช้เฉพาะผลที่ APPROVED — ผล Draft หรือที่ถูกตีกลับไม่ถูกนำมาคำนวณ
 */

/** ผลที่อนุมัติแล้วของแต่ละประเภทรางวัล เอา version ล่าสุด */
async function approvedResults(tx: TxClient, drawId: string) {
  const rows = await tx.result.findMany({
    where: { drawId, status: "APPROVED" },
    orderBy: { version: "desc" },
    select: { prizeTypeId: true, value: true, version: true },
  });

  const byPrizeType = new Map<string, string>();
  for (const row of rows) {
    if (!byPrizeType.has(row.prizeTypeId)) byPrizeType.set(row.prizeTypeId, row.value);
  }
  return byPrizeType;
}

export type SettlementPreview = {
  agentId: string;
  agentCode: string;
  agentName: string;
  gross: Prisma.Decimal;
  payout: Prisma.Decimal;
  commission: Prisma.Decimal;
  net: Prisma.Decimal;
  commissionRateSnapshot: Prisma.Decimal;
  winningItems: number;
  totalItems: number;
};

/**
 * คำนวณยอดของทุก Agent ในรอบ โดยไม่เขียนอะไรลงฐานข้อมูล
 *
 * แยกออกมาเป็นฟังก์ชันของตัวเองเพื่อให้ดูตัวเลขก่อนยืนยันได้
 * และเพื่อให้ calculateSettlement กับการคำนวณซ้ำใช้ตรรกะเดียวกัน
 */
export async function previewSettlement(
  tx: TxClient,
  drawId: string,
): Promise<SettlementPreview[]> {
  const resultsByPrizeType = await approvedResults(tx, drawId);

  const bills = await tx.bill.findMany({
    where: { drawId, status: { in: ["LOCKED", "SETTLED"] } },
    select: {
      id: true,
      agentId: true,
      agent: { select: { code: true, name: true, commissionRate: true } },
      items: {
        select: {
          id: true,
          prizeTypeId: true,
          number: true,
          stake: true,
          payoutRateSnapshot: true,
          prizeType: { select: { matchRule: true } },
        },
      },
    },
  });

  type Bucket = {
    agentCode: string;
    agentName: string;
    commissionRate: Prisma.Decimal;
    stakes: Prisma.Decimal[];
    payouts: Prisma.Decimal[];
    winningItems: number;
    totalItems: number;
  };

  const byAgent = new Map<string, Bucket>();

  for (const bill of bills) {
    let bucket = byAgent.get(bill.agentId);
    if (!bucket) {
      bucket = {
        agentCode: bill.agent.code,
        agentName: bill.agent.name,
        commissionRate: bill.agent.commissionRate,
        stakes: [],
        payouts: [],
        winningItems: 0,
        totalItems: 0,
      };
      byAgent.set(bill.agentId, bucket);
    }

    for (const item of bill.items) {
      bucket.stakes.push(item.stake);
      bucket.totalItems += 1;

      const resultValue = resultsByPrizeType.get(item.prizeTypeId);
      if (resultValue === undefined) continue;

      const won = isWinning({
        number: item.number,
        resultValue,
        matchRule: item.prizeType.matchRule,
      });

      if (won) {
        bucket.payouts.push(itemPayout(item.stake, item.payoutRateSnapshot));
        bucket.winningItems += 1;
      }
    }
  }

  return [...byAgent.entries()]
    .map(([agentId, b]) => {
      const gross = sumMoney(b.stakes);
      const payout = sumMoney(b.payouts);
      const commission = commissionOf({
        gross,
        payout,
        commissionRatePercent: b.commissionRate,
      });
      return {
        agentId,
        agentCode: b.agentCode,
        agentName: b.agentName,
        gross,
        payout,
        commission,
        net: netOf({ gross, payout, commission }),
        commissionRateSnapshot: b.commissionRate,
        winningItems: b.winningItems,
        totalItems: b.totalItems,
      };
    })
    .sort((a, b) => a.agentCode.localeCompare(b.agentCode));
}

/**
 * คำนวณและบันทึก Settlement พร้อมเขียนผลลงรายการบิล
 *
 * รันซ้ำได้ — ใช้ upsert และเขียนทับผลเดิม ตัวเลขที่ได้จะเท่าเดิมเสมอ
 * ตราบใดที่บิลและผลรางวัลไม่เปลี่ยน
 */
export async function calculateSettlement(
  actor: Actor,
  drawId: string,
): Promise<SettlementPreview[]> {
  requirePermission(actor, "settlement.calculate");

  return prisma.$transaction(async (tx) => {
    const draw = await tx.draw.findFirst({
      where: { id: drawId, ...orgScope(actor) },
      select: { id: true, status: true, name: true },
    });
    if (!draw) throw new NotFoundError("ไม่พบรอบ");
    if (draw.status === "CLOSED") {
      throw new ConflictError("รอบนี้ปิดบัญชีแล้ว คำนวณใหม่ไม่ได้");
    }
    if (draw.status === "OPEN") {
      throw new ConflictError("ต้องปิดรับรอบก่อนจึงจะคำนวณได้");
    }

    const resultsByPrizeType = await approvedResults(tx, draw.id);
    if (resultsByPrizeType.size === 0) {
      throw new ConflictError("ยังไม่มีผลรางวัลที่อนุมัติแล้วในรอบนี้");
    }

    const previews = await previewSettlement(tx, draw.id);

    // เขียนผลว่ารายการไหนถูกรางวัลและจ่ายเท่าไร
    const bills = await tx.bill.findMany({
      where: { drawId: draw.id, status: { in: ["LOCKED", "SETTLED"] } },
      select: {
        id: true,
        items: {
          select: {
            id: true,
            prizeTypeId: true,
            number: true,
            stake: true,
            payoutRateSnapshot: true,
            prizeType: { select: { matchRule: true } },
          },
        },
      },
    });

    for (const bill of bills) {
      const billPayouts: Prisma.Decimal[] = [];

      for (const item of bill.items) {
        const resultValue = resultsByPrizeType.get(item.prizeTypeId);
        const won =
          resultValue !== undefined &&
          isWinning({
            number: item.number,
            resultValue,
            matchRule: item.prizeType.matchRule,
          });
        const payout = won ? itemPayout(item.stake, item.payoutRateSnapshot) : ZERO;
        if (won) billPayouts.push(payout);

        await tx.billItem.update({
          where: { id: item.id },
          data: { isWinner: won, payout },
        });
      }

      await tx.bill.update({
        where: { id: bill.id },
        data: { status: "SETTLED", totalPayout: sumMoney(billPayouts) },
      });
    }

    for (const preview of previews) {
      await tx.settlement.upsert({
        where: { drawId_agentId: { drawId: draw.id, agentId: preview.agentId } },
        create: {
          organizationId: actor.organizationId,
          drawId: draw.id,
          agentId: preview.agentId,
          gross: preview.gross,
          payout: preview.payout,
          commission: preview.commission,
          net: preview.net,
          commissionRateSnapshot: preview.commissionRateSnapshot,
          status: "DRAFT",
        },
        update: {
          gross: preview.gross,
          payout: preview.payout,
          commission: preview.commission,
          net: preview.net,
          commissionRateSnapshot: preview.commissionRateSnapshot,
          calculatedAt: new Date(),
        },
      });
    }

    await tx.draw.update({ where: { id: draw.id }, data: { status: "SETTLED" } });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "UPDATE",
      entityType: "Draw",
      entityId: draw.id,
      before: { status: draw.status },
      after: {
        status: "SETTLED",
        agents: previews.length,
        totalNet: sumMoney(previews.map((p) => p.net)).toFixed(2),
      },
      reason: "คำนวณ Settlement",
    });

    return previews;
  });
}

export async function reconcileSettlement(actor: Actor, settlementId: string): Promise<void> {
  requirePermission(actor, "settlement.reconcile");

  await prisma.$transaction(async (tx) => {
    const settlement = await tx.settlement.findFirst({
      where: { id: settlementId, ...orgScope(actor) },
      select: { id: true, status: true },
    });
    if (!settlement) throw new NotFoundError("ไม่พบรายการสรุป");
    if (settlement.status !== "DRAFT") throw new ConflictError("รายการนี้ตรวจสอบยอดไปแล้ว");

    await tx.settlement.update({
      where: { id: settlement.id },
      data: { status: "RECONCILED", reconciledById: actor.userId, reconciledAt: new Date() },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "UPDATE",
      entityType: "Settlement",
      entityId: settlement.id,
      before: { status: "DRAFT" },
      after: { status: "RECONCILED" },
      reason: "ตรวจสอบยอดแล้ว",
    });
  });
}

/**
 * Owner อนุมัติปิดบัญชีทั้งรอบ
 *
 * Transaction boundary ที่ห้ามแยก: เปลี่ยนสถานะ Settlement ทุกใบ
 * + ปิดรอบ + เขียน Audit ต้องอยู่ด้วยกัน
 */
export async function approveSettlement(actor: Actor, drawId: string): Promise<void> {
  requirePermission(actor, "settlement.approve");

  await prisma.$transaction(async (tx) => {
    const draw = await tx.draw.findFirst({
      where: { id: drawId, ...orgScope(actor) },
      select: { id: true, status: true, name: true },
    });
    if (!draw) throw new NotFoundError("ไม่พบรอบ");
    if (draw.status !== "SETTLED") {
      throw new ConflictError("ต้องคำนวณ Settlement ก่อนจึงจะปิดบัญชีได้");
    }

    const settlements = await tx.settlement.findMany({
      where: { drawId: draw.id },
      select: { id: true, status: true, net: true },
    });

    if (settlements.length === 0) throw new ConflictError("ไม่มีรายการสรุปให้อนุมัติ");

    const notReconciled = settlements.filter((s) => s.status === "DRAFT");
    if (notReconciled.length > 0) {
      throw new ConflictError(
        `ยังมี ${notReconciled.length} รายการที่ยังไม่ได้ตรวจสอบยอด ต้องตรวจสอบยอดให้ครบก่อนปิดบัญชี`,
      );
    }

    const now = new Date();
    await tx.settlement.updateMany({
      where: { drawId: draw.id },
      data: { status: "APPROVED", approvedById: actor.userId, approvedAt: now },
    });

    await tx.draw.update({
      where: { id: draw.id },
      data: { status: "CLOSED", closedAt: now },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "APPROVE",
      entityType: "Draw",
      entityId: draw.id,
      before: { status: "SETTLED" },
      after: {
        status: "CLOSED",
        settlements: settlements.length,
        totalNet: toMoney(
          settlements.reduce<Prisma.Decimal>((sum, s) => sum.plus(s.net), ZERO),
        ).toFixed(2),
      },
      reason: "อนุมัติปิดบัญชีรอบ",
    });
  });
}

export async function listSettlements(actor: Actor, drawId: string) {
  requirePermission(actor, "bill.viewOwn");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, name: true, status: true },
  });
  if (!draw) throw new NotFoundError("ไม่พบรอบ");

  const settlements = await prisma.settlement.findMany({
    where: {
      drawId: draw.id,
      ...orgScope(actor),
      // Agent เห็นเฉพาะยอดของตนเอง
      ...(actor.role === "AGENT" && { agentId: actor.agentId ?? "__no_agent__" }),
    },
    orderBy: { agent: { code: "asc" } },
    select: {
      id: true,
      gross: true,
      payout: true,
      commission: true,
      net: true,
      commissionRateSnapshot: true,
      status: true,
      agent: { select: { code: true, name: true } },
      reconciledBy: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
    },
  });

  return { draw, settlements };
}

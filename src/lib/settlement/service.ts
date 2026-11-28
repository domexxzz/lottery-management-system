import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit, type TxClient } from "@/lib/audit";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { commissionOf, itemPayout, netOf, sumMoney, toMoney, ZERO } from "@/lib/money";
import { isWinningAny } from "@/lib/results/matching";
import { storedResultValues } from "@/lib/results/values";
import {
  laoSetMatchedPrizeKeys,
  LAO_SET_PRIZE_LABELS,
  LAO_SET_PRIZE_TYPE_CODES,
  type LaoSetPrizeKey,
} from "@/lib/lao/rules";
import { commissionDecision, type AgentCommissionPromotion } from "@/lib/agents/commission";
import { drawDay as resolveDrawDay } from "@/lib/draws/range";

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
    select: {
      prizeTypeId: true,
      value: true,
      values: true,
      version: true,
      prizeType: { select: { code: true } },
    },
  });

  const byPrizeType = new Map<string, string[]>();
  const byPrizeCode = new Map<number, string[]>();
  for (const row of rows) {
    const values = storedResultValues(row);
    if (!byPrizeType.has(row.prizeTypeId)) byPrizeType.set(row.prizeTypeId, values);
    if (!byPrizeCode.has(row.prizeType.code)) byPrizeCode.set(row.prizeType.code, values);
  }
  return { byPrizeType, byPrizeCode };
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
  /// อัตราปกติก่อนคิดโปรโมชั่น เก็บคู่กันเพื่ออธิบายส่วนต่างให้ Agent ได้
  commissionBaseRateSnapshot: Prisma.Decimal;
  commissionPromotionApplied: boolean;
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
  const draw = await tx.draw.findUnique({ where: { id: drawId }, select: { organizationId: true, lotteryType: true, drawDate: true, cutoffAt: true } });
  if (!draw) throw new NotFoundError("ไม่พบรอบ");
  const results = await approvedResults(tx, drawId);
  const bills = await loadSettlementBills(tx, drawId);
  const laoSetRules = draw.lotteryType === "LAO_SET" ? await loadLaoSetPayoutRules(tx, draw.organizationId) : null;
  return evaluateSettlement(bills, results, laoSetRules, draw.lotteryType, resolveDrawDay(draw)).previews;
}

type LaoSetPayoutRule = { prizeTypeId: string; payoutRate: Prisma.Decimal };

/** อ่านอัตราจ่ายจริงจาก Rulebook ในฐานข้อมูล เฉพาะตอนคำนวณหวยลาวชุด */
async function loadLaoSetPayoutRules(tx: TxClient, organizationId: string): Promise<Map<LaoSetPrizeKey, LaoSetPayoutRule>> {
  const codeByKey = Object.entries(LAO_SET_PRIZE_TYPE_CODES) as [LaoSetPrizeKey, number][];
  const rows = await tx.prizeType.findMany({
    where: { organizationId, lotteryType: "LAO_SET", code: { in: codeByKey.map(([, code]) => code) } },
    select: { id: true, code: true, payoutRate: true },
  });
  const rowByCode = new Map(rows.map((row) => [row.code, row]));
  const rules = new Map<LaoSetPrizeKey, LaoSetPayoutRule>();
  for (const [key, code] of codeByKey) {
    const row = rowByCode.get(code);
    if (!row) throw new ConflictError(`Rulebook หวยลาวชุดไม่ครบ: ไม่พบ ${LAO_SET_PRIZE_LABELS[key]}`);
    rules.set(key, { prizeTypeId: row.id, payoutRate: row.payoutRate });
  }
  return rules;
}

/** บิลที่มีผลผูกพันของรอบ พร้อมรายการเลข โหลดครั้งเดียวแล้วใช้ทั้งคำนวณยอดและเขียนผล */
function loadSettlementBills(tx: TxClient, drawId: string) {
  return tx.bill.findMany({
    where: { drawId, status: { in: ["LOCKED", "SETTLED"] } },
    select: {
      id: true,
      agentId: true,
      agent: {
        select: {
          code: true,
          name: true,
          commissionRate: true,
          laoCommissionRate: true,
          commissionPromotionStartsOn: true,
          commissionPromotionEndsOn: true,
          commissionPromotionThaiMinGross: true,
          commissionPromotionLaoMinGross: true,
          commissionPromotionThaiRate: true,
          commissionPromotionLaoRate: true,
        },
      },
      items: {
        select: {
          id: true,
          organizationId: true,
          prizeTypeId: true,
          number: true,
          stake: true,
          packagePrice: true,
          quantity: true,
          payoutRateSnapshot: true,
          prizeType: { select: { code: true, matchRule: true } },
        },
      },
    },
  });
}

type SettlementBill = Awaited<ReturnType<typeof loadSettlementBills>>[number];

/**
 * ตัดสินผลทุกรายการและสรุปยอดต่อ Agent ใน pass เดียว
 *
 * คืนทั้งยอดสรุปและรายการที่ถูกรางวัลพร้อมยอดจ่าย ให้ calculateSettlement เขียนลงฐานข้อมูลต่อ
 */
function evaluateSettlement(
  bills: SettlementBill[],
  results: { byPrizeType: Map<string, string[]>; byPrizeCode: Map<number, string[]> },
  laoSetRules: Map<LaoSetPrizeKey, LaoSetPayoutRule> | null,
  lotteryType: "THAI_GOVERNMENT" | "LAO" | "LAO_SET",
  drawDay: string,
) {
  type Bucket = {
    agentCode: string;
    agentName: string;
    commissionPolicy: AgentCommissionPromotion;
    stakes: Prisma.Decimal[];
    payouts: Prisma.Decimal[];
    winningItems: number;
    totalItems: number;
  };

  const byAgent = new Map<string, Bucket>();
  const winningItems: { itemId: string; payout: Prisma.Decimal }[] = [];
  const winningPrizeRows: Array<{
    organizationId: string;
    billItemId: string;
    prizeTypeId: string;
    prizeKey: LaoSetPrizeKey;
    prizeLabelSnapshot: string;
    payoutRateSnapshot: Prisma.Decimal;
    payout: Prisma.Decimal;
    resultValue: string;
    isPaid: boolean;
  }> = [];
  const billPayouts = new Map<string, Prisma.Decimal>();

  for (const bill of bills) {
    let bucket = byAgent.get(bill.agentId);
    if (!bucket) {
      bucket = {
        agentCode: bill.agent.code,
        agentName: bill.agent.name,
        commissionPolicy: bill.agent,
        stakes: [],
        payouts: [],
        winningItems: 0,
        totalItems: 0,
      };
      byAgent.set(bill.agentId, bucket);
    }

    // หวยลาวชุด: รวม quantity เฉพาะตอนเลือกรางวัลสูงสุดตาม Bill + เลข + ราคาชุด
    // แต่ไม่รวม BillItem ในฐานข้อมูล แต่ละรายการจึงยังเป็น Bet ID ต้นทางที่ Audit ได้ครบ
    const laoSetSelectedPrizeByItem = new Map<string, LaoSetPrizeKey>();
    if (laoSetRules) {
      const groups = new Map<string, { unitPrice: Prisma.Decimal; quantity: number; items: typeof bill.items }>();
      for (const item of bill.items) {
        if (item.prizeType.code !== 201) continue;
        const quantity = Math.max(1, item.quantity);
        const unitPrice = item.packagePrice ?? item.stake.dividedBy(quantity);
        const key = `${item.number}:${unitPrice.toFixed(2)}`;
        const group = groups.get(key) ?? { unitPrice, quantity: 0, items: [] };
        group.quantity += quantity;
        group.items.push(item);
        groups.set(key, group);
      }
      for (const group of groups.values()) {
        const first = group.items[0];
        const resultValue = first ? results.byPrizeCode.get(201)?.[0] : undefined;
        const matchedKeys = first && resultValue ? laoSetMatchedPrizeKeys(first.number, resultValue) : [];
        const selected = matchedKeys.reduce<{ key: LaoSetPrizeKey; payout: Prisma.Decimal } | null>((highest, key) => {
          const rule = laoSetRules.get(key);
          if (!rule) throw new ConflictError(`Rulebook หวยลาวชุดไม่ครบ: ไม่พบ ${LAO_SET_PRIZE_LABELS[key]}`);
          const payout = toMoney(itemPayout(group.unitPrice, rule.payoutRate).times(group.quantity));
          return !highest || payout.greaterThan(highest.payout) ? { key, payout } : highest;
        }, null);
        if (selected) for (const item of group.items) laoSetSelectedPrizeByItem.set(item.id, selected.key);
      }
    }

    const payoutsOfBill: Prisma.Decimal[] = [];
    for (const item of bill.items) {
      bucket.stakes.push(item.stake);
      bucket.totalItems += 1;

      // แยกเฉพาะหวยลาวชุดจาก LotteryType ของงวดและรหัสรายการขาย 201
      // ตรวจครบ 8 เงื่อนไข แต่เลือกจ่ายรางวัลที่มียอดสูงสุดเพียงรางวัลเดียวต่อ BillItem (Bet ID)
      if (laoSetRules && item.prizeType.code === 201) {
        const resultValue = results.byPrizeCode.get(201)?.[0];
        const matchedKeys = resultValue ? laoSetMatchedPrizeKeys(item.number, resultValue) : [];
        const candidates = matchedKeys.map((key) => {
          const rule = laoSetRules.get(key);
          if (!rule) throw new ConflictError(`Rulebook หวยลาวชุดไม่ครบ: ไม่พบ ${LAO_SET_PRIZE_LABELS[key]}`);
          // หวยชุดคิดยอดต่อ 1 ชุดให้เป็นเงินก่อน แล้วจึงคูณจำนวนชุด
          // ป้องกันเรตทศนิยม เช่น 11.6667 ทำให้ 120 บาท × 2 ชุดกลายเป็น 2,800.01
          // และยังคงอ่านอัตราจ่ายจริงจาก Rulebook ในฐานข้อมูล ไม่ hardcode ยอดรางวัล
          const quantity = Math.max(1, item.quantity);
          const unitPrice = item.packagePrice ?? item.stake.dividedBy(quantity);
          const payout = toMoney(itemPayout(unitPrice, rule.payoutRate).times(quantity));
          return { key, rule, payout };
        });
        // รางวัลที่เลือกมาจากกลุ่ม Bill + เลข + ราคาชุดเดียวกัน จำนวนชุดต่างรายการจึงรวมกัน
        const selectedKey = laoSetSelectedPrizeByItem.get(item.id);
        const selected = candidates.find((candidate) => candidate.key === selectedKey) ?? null;
        for (const candidate of candidates) {
          const isPaid = candidate.key === selected?.key;
          winningPrizeRows.push({
            organizationId: item.organizationId,
            billItemId: item.id,
            prizeTypeId: candidate.rule.prizeTypeId,
            prizeKey: candidate.key,
            prizeLabelSnapshot: LAO_SET_PRIZE_LABELS[candidate.key],
            payoutRateSnapshot: candidate.rule.payoutRate,
            payout: candidate.payout,
            resultValue: resultValue!,
            isPaid,
          });
        }
        if (selected) {
          bucket.payouts.push(selected.payout);
          bucket.winningItems += 1;
          payoutsOfBill.push(selected.payout);
          winningItems.push({ itemId: item.id, payout: selected.payout });
        }
        continue;
      }

      // รหัส 10/11 เป็นข้อมูลเก่าจากยุคที่บันทึก "สลับ" เป็นรางวัลแยก
      // ปัจจุบันสลับเป็นเพียงตัวช่วยสร้างเลข จึงใช้ผล 3 ตัวบน/2 ตัวบนตามลำดับ
      const legacySourceCode = item.prizeType.code === 10 ? 1 : item.prizeType.code === 11 ? 5 : null;
      const resultValues = legacySourceCode === null
        ? results.byPrizeType.get(item.prizeTypeId)
        : results.byPrizeCode.get(legacySourceCode);
      if (resultValues === undefined) continue;

      const won = isWinningAny({
        number: item.number,
        resultValues,
        matchRule: item.prizeType.matchRule,
      });

      if (won) {
        const payout = itemPayout(item.stake, item.payoutRateSnapshot);
        bucket.payouts.push(payout);
        bucket.winningItems += 1;
        payoutsOfBill.push(payout);
        winningItems.push({ itemId: item.id, payout });
      }
    }
    if (payoutsOfBill.length > 0) billPayouts.set(bill.id, sumMoney(payoutsOfBill));
  }

  const previews = [...byAgent.entries()]
    .map(([agentId, b]) => {
      const gross = sumMoney(b.stakes);
      const payout = sumMoney(b.payouts);
      const decision = commissionDecision({
        agent: b.commissionPolicy,
        lotteryType,
        drawDay,
        gross,
      });
      const commission = commissionOf({
        gross,
        payout,
        commissionRatePercent: decision.rate,
      });
      return {
        agentId,
        agentCode: b.agentCode,
        agentName: b.agentName,
        gross,
        payout,
        commission,
        net: netOf({ gross, payout, commission }),
        commissionRateSnapshot: decision.rate,
        commissionBaseRateSnapshot: decision.baseRate,
        commissionPromotionApplied: decision.promotionApplied,
        winningItems: b.winningItems,
        totalItems: b.totalItems,
      };
    })
    .sort((a, b) => a.agentCode.localeCompare(b.agentCode));

  return { previews, winningItems, winningPrizeRows, billPayouts };
}

/** จัดกลุ่ม id ตามยอดเงินเดียวกัน เพื่อเขียนด้วย updateMany ครั้งเดียวต่อยอด */
function groupByAmount<T>(rows: T[], idOf: (row: T) => string, amountOf: (row: T) => Prisma.Decimal) {
  const groups = new Map<string, { amount: Prisma.Decimal; ids: string[] }>();
  for (const row of rows) {
    const amount = amountOf(row);
    const key = amount.toString();
    const group = groups.get(key) ?? { amount, ids: [] };
    group.ids.push(idOf(row));
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * คำนวณและบันทึก Settlement พร้อมเขียนผลลงรายการบิล
 *
 * รันซ้ำได้ — ใช้ upsert และเขียนทับผลเดิม ตัวเลขที่ได้จะเท่าเดิมเสมอ
 * ตราบใดที่บิลและผลรางวัลไม่เปลี่ยน
 */
async function calculateSettlementSingle(
  actor: Actor,
  drawId: string,
): Promise<SettlementPreview[]> {
  requirePermission(actor, "settlement.calculate");

  return prisma.$transaction(async (tx) => {
    const draw = await tx.draw.findFirst({
      where: { id: drawId, ...orgScope(actor) },
      select: { id: true, organizationId: true, lotteryType: true, status: true, name: true, drawDate: true, cutoffAt: true },
    });
    if (!draw) throw new NotFoundError("ไม่พบรอบ");
    if (draw.status === "CLOSED") {
      throw new ConflictError("รอบนี้ปิดบัญชีแล้ว คำนวณใหม่ไม่ได้");
    }
    if (draw.status === "OPEN") {
      throw new ConflictError("ต้องปิดรับรอบก่อนจึงจะคำนวณได้");
    }

    const results = await approvedResults(tx, draw.id);
    if (results.byPrizeType.size === 0) {
      throw new ConflictError("ยังไม่มีผลรางวัลที่อนุมัติแล้วในรอบนี้");
    }

    // โหลดบิลครั้งเดียว ตัดสินผลครั้งเดียว แล้วเขียนแบบเป็นชุด
    // เดิมโหลดบิลสองรอบ และ UPDATE ทีละรายการทีละบิลภายใน transaction
    // ซึ่งเป็นหลักร้อยถึงหลักพันคำสั่งต่องวด และเสี่ยงชน timeout ของ transaction เมื่อข้อมูลโต
    const bills = await loadSettlementBills(tx, draw.id);
    const laoSetRules = draw.lotteryType === "LAO_SET" ? await loadLaoSetPayoutRules(tx, draw.organizationId) : null;
    const { previews, winningItems, winningPrizeRows, billPayouts } = evaluateSettlement(
      bills,
      results,
      laoSetRules,
      draw.lotteryType,
      resolveDrawDay(draw),
    );
    const billIds = bills.map((bill) => bill.id);

    if (billIds.length > 0) {
      // ล้างผลเดิมของทุกรายการก่อน แล้วค่อยเขียนเฉพาะรายการที่ถูกรางวัล
      await tx.billItem.updateMany({ where: { billId: { in: billIds } }, data: { isWinner: false, payout: ZERO } });
      // ล้างและสร้าง payout ledger ของงวดใหม่ภายใน transaction เดียวกัน
      // unique(billItemId, prizeKey) ป้องกันรายการซ้ำ และการคำนวณซ้ำให้ผลชุดเดิมเสมอ
      await tx.billItemWinningPrize.deleteMany({ where: { billItem: { billId: { in: billIds } } } });
      if (winningPrizeRows.length > 0) await tx.billItemWinningPrize.createMany({ data: winningPrizeRows });
      for (const group of groupByAmount(winningItems, (row) => row.itemId, (row) => row.payout)) {
        await tx.billItem.updateMany({ where: { id: { in: group.ids } }, data: { isWinner: true, payout: group.amount } });
      }

      await tx.bill.updateMany({ where: { id: { in: billIds } }, data: { status: "SETTLED", totalPayout: ZERO } });
      for (const group of groupByAmount([...billPayouts.entries()], ([billId]) => billId, ([, amount]) => amount)) {
        await tx.bill.updateMany({ where: { id: { in: group.ids } }, data: { totalPayout: group.amount } });
      }
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
          commissionBaseRateSnapshot: preview.commissionBaseRateSnapshot,
          commissionPromotionApplied: preview.commissionPromotionApplied,
          status: "DRAFT",
        },
        update: {
          gross: preview.gross,
          payout: preview.payout,
          commission: preview.commission,
          net: preview.net,
          commissionRateSnapshot: preview.commissionRateSnapshot,
          commissionBaseRateSnapshot: preview.commissionBaseRateSnapshot,
          commissionPromotionApplied: preview.commissionPromotionApplied,
          status: "DRAFT",
          calculatedAt: new Date(),
          reconciledById: null,
          reconciledAt: null,
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
  }, { timeout: 60_000, maxWait: 10_000 });
}

/**
 * คำนวณงวดที่เลือก และถ้าเป็นคู่งวดลาวให้คำนวณอีกฝั่งด้วย
 * คืนผลของงวดที่ผู้ใช้กดก่อนเสมอ เพื่อให้หน้าจอเดิมยังแสดงตัวเลขของงวดที่เลือกถูกต้อง
 */
export async function calculateSettlement(actor: Actor, drawId: string): Promise<SettlementPreview[]> {
  requirePermission(actor, "settlement.calculate");
  const selected = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, organizationId: true, lotteryType: true, laoFamilyId: true },
  });
  if (!selected) throw new NotFoundError("ไม่พบรอบ");

  const paired = (selected.lotteryType === "LAO" || selected.lotteryType === "LAO_SET") && selected.laoFamilyId;
  const siblings = paired
    ? await prisma.draw.findMany({
      where: {
        organizationId: selected.organizationId,
        laoFamilyId: selected.laoFamilyId,
        lotteryType: { in: ["LAO", "LAO_SET"] },
        id: { not: selected.id },
      },
      orderBy: { lotteryType: "asc" },
      select: { id: true },
    })
    : [];

  const previews: SettlementPreview[] = [];
  for (const id of [selected.id, ...siblings.map((draw) => draw.id)]) {
    previews.push(...await calculateSettlementSingle(actor, id));
  }
  return previews;
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
async function approveSettlementSingle(actor: Actor, drawId: string): Promise<void> {
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

    if (settlements.length === 0) {
      const billCount = await tx.bill.count({
        where: { drawId: draw.id, status: { in: ["LOCKED", "SETTLED"] } },
      });
      // คู่งวดอาจมีบิลเฉพาะอีกประเภท ฝั่งที่ไม่มีบิลต้องปิดบัญชีตามคู่ได้
      if (billCount > 0) throw new ConflictError("ไม่มีรายการสรุปให้อนุมัติ");
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

/** ปิดบัญชีงวดที่เลือกและคู่งวดลาวพร้อมกัน */
export async function approveSettlement(actor: Actor, drawId: string): Promise<void> {
  requirePermission(actor, "settlement.approve");
  const selected = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, organizationId: true, lotteryType: true, laoFamilyId: true },
  });
  if (!selected) throw new NotFoundError("ไม่พบรอบ");
  const paired = (selected.lotteryType === "LAO" || selected.lotteryType === "LAO_SET") && selected.laoFamilyId;
  const siblings = paired
    ? await prisma.draw.findMany({
      where: {
        organizationId: selected.organizationId,
        laoFamilyId: selected.laoFamilyId,
        lotteryType: { in: ["LAO", "LAO_SET"] },
        id: { not: selected.id },
      },
      orderBy: { lotteryType: "asc" },
      select: { id: true },
    })
    : [];
  for (const id of [selected.id, ...siblings.map((draw) => draw.id)]) {
    const draw = await prisma.draw.findUnique({ where: { id }, select: { status: true } });
    if (draw?.status === "CLOSED") continue;
    await approveSettlementSingle(actor, id);
  }
}

export async function listSettlements(actor: Actor, drawId: string) {
  requirePermission(actor, "bill.viewOwn");

  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor) },
    select: { id: true, name: true, status: true, lotteryType: true },
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
      commissionBaseRateSnapshot: true,
      commissionPromotionApplied: true,
      status: true,
      agentId: true,
      agent: { select: { code: true, name: true } },
      reconciledBy: { select: { displayName: true } },
      approvedBy: { select: { displayName: true } },
    },
  });

  // รายการที่ถูกรางวัล (เขียนไว้ตอนคำนวณ Settlement) ใช้บอกว่าถูกเลขไหน ลงเท่าไหร่ จ่ายกี่เท่า
  // ใช้ชุดบิลเดียวกับที่ Settlement นับ (LOCKED/SETTLED) จึงรวมแล้วเท่ากับยอดจ่ายรางวัลของ Agent
  const billWhere: Prisma.BillWhereInput = {
    drawId: draw.id,
    status: { in: ["LOCKED", "SETTLED"] },
    ...(actor.role === "AGENT" && { agentId: actor.agentId ?? "__no_agent__" }),
  };
  const winningItems = settlements.length === 0 ? [] : draw.lotteryType === "LAO_SET"
    ? (await prisma.billItemWinningPrize.findMany({
        where: { ...orgScope(actor), isPaid: true, billItem: { bill: billWhere } },
        orderBy: [{ payout: "desc" }, { id: "asc" }],
        select: {
          id: true,
          prizeLabelSnapshot: true,
          payoutRateSnapshot: true,
          payout: true,
          prizeType: { select: { code: true } },
          billItem: {
            select: {
              number: true,
              stake: true,
              bill: { select: { id: true, drawSequence: true, title: true, agentId: true } },
            },
          },
        },
      })).map((row) => ({
        id: row.id,
        number: row.billItem.number,
        stake: row.billItem.stake,
        payoutRateSnapshot: row.payoutRateSnapshot,
        payout: row.payout,
        prizeType: { code: row.prizeType.code, name: row.prizeLabelSnapshot },
        bill: row.billItem.bill,
      }))
    : await prisma.billItem.findMany({
        where: { ...orgScope(actor), isWinner: true, bill: billWhere },
        orderBy: [{ payout: "desc" }, { id: "asc" }],
        select: {
          id: true,
          number: true,
          stake: true,
          payoutRateSnapshot: true,
          payout: true,
          prizeType: { select: { code: true, name: true } },
          bill: { select: { id: true, drawSequence: true, title: true, agentId: true } },
        },
      });

  return { draw, settlements, winningItems };
}

/**
 * รายงานผลกระทบแบบอ่านอย่างเดียวสำหรับ Settlement หวยลาวชุดที่คำนวณด้วยกติกาเดิม
 * ไม่เขียนฐานข้อมูลและไม่แก้ยอดย้อนหลัง ผู้ใช้ต้องตรวจสอบก่อนกดคำนวณใหม่
 */
export async function laoSetSettlementImpact(actor: Actor, drawId: string) {
  requirePermission(actor, "bill.viewOwn");
  const draw = await prisma.draw.findFirst({
    where: { id: drawId, ...orgScope(actor), lotteryType: "LAO_SET" },
    select: { id: true, organizationId: true, officialNumber: true, status: true },
  });
  if (!draw?.officialNumber || (draw.status !== "SETTLED" && draw.status !== "CLOSED")) return null;

  const rules = await loadLaoSetPayoutRules(prisma, draw.organizationId);
  const items = await prisma.billItem.findMany({
    where: {
      ...orgScope(actor),
      prizeType: { code: 201, lotteryType: "LAO_SET" },
      bill: {
        drawId: draw.id,
        status: "SETTLED",
        ...(actor.role === "AGENT" && { agentId: actor.agentId ?? "__no_agent__" }),
      },
    },
    select: { id: true, number: true, stake: true, payout: true },
  });

  let affectedItems = 0;
  const storedPayouts: Prisma.Decimal[] = [];
  const expectedPayouts: Prisma.Decimal[] = [];
  for (const item of items) {
    const matchedPayouts = laoSetMatchedPrizeKeys(item.number, draw.officialNumber).map((key) => {
      const rule = rules.get(key);
      if (!rule) throw new ConflictError(`Rulebook หวยลาวชุดไม่ครบ: ไม่พบ ${LAO_SET_PRIZE_LABELS[key]}`);
      return itemPayout(item.stake, rule.payoutRate);
    });
    const expected = matchedPayouts.reduce(
      (highest, payout) => payout.greaterThan(highest) ? payout : highest,
      ZERO,
    );
    storedPayouts.push(item.payout);
    expectedPayouts.push(expected);
    if (!item.payout.equals(expected)) affectedItems += 1;
  }
  const storedPayout = sumMoney(storedPayouts);
  const expectedPayout = sumMoney(expectedPayouts);
  return {
    checkedItems: items.length,
    affectedItems,
    storedPayout,
    expectedPayout,
    difference: expectedPayout.minus(storedPayout),
    closed: draw.status === "CLOSED",
  };
}

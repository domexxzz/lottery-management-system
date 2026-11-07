import type { Actor } from "@/lib/auth/context";
import type { BillStatus, Prisma } from "@prisma/client";
import { orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { drawSummary } from "@/lib/reports/service";
import { sanitizeLabel } from "./sanitize";

/**
 * ข้อมูลสรุปที่ส่งให้ผู้ช่วย AI
 *
 * กฎสองข้อที่ไฟล์นี้บังคับ
 *
 * 1. ตัวเลขการเงินทุกตัวมาจาก drawSummary() ตัวเดียวกับที่หน้ารายงานใช้
 *    ไม่ query เอง เพราะถ้า query เองจะนับบิลคนละชุด (รายงานไม่นับร่างและที่ยกเลิก)
 *    แล้วผู้ช่วยจะตอบตัวเลขที่ขัดกับหน้ารายงานของระบบตัวเอง
 *
 * 2. ส่งข้อมูลเท่าที่ Owner ขอใช้ถามงานจริง
 *    เลขที่ซื้อทั่วไปส่งเฉพาะ Top 5 แบบรวมทั้งรอบ ส่วนชื่อบิล/รหัสลูกค้า
 *    ส่งเฉพาะรายการที่ถูกรางวัล และไม่ส่งชื่อ Agent เลขอ้างอิงการโอน
 *    หลักฐาน หรือข้อมูลการชำระเงิน
 */

export type OwnerSnapshot = {
  generatedAt: string;
  organization: { name: string; timezone: string };
  overall: {
    scopeLabel: string;
    draws: number;
    bills: number;
    items: number;
    sales: string;
    prizeExpense: string;
    uniqueCustomers: number;
    repeatCustomers: number;
    repeatRatePercent: string;
    averageBill: string;
    winningCustomers: number;
    highDemandNumbers: {
      rank: number;
      number: string;
      itemCount: number;
      stake: string;
    }[];
    prizeTypeDemand: {
      rank: number;
      prizeType: string;
      itemCount: number;
      stake: string;
    }[];
    billStatusCounts: { status: string; count: number }[];
  };
  /**
   * กำไรขาดทุนรายรอบที่จัดอันดับมาแล้ว
   *
   * มีไว้เพื่อให้คำถามอย่าง "รอบไหนกำไรสุด" ตอบได้โดยอ่านค่าตรง ๆ
   * ไม่ต้องให้โมเดลไล่เทียบตัวเลขเอง ซึ่งเป็นจุดที่เคยตอบผิด
   */
  profitability: {
    /** จำนวนรอบที่คำนวณ Settlement แล้ว จึงนำมาเทียบกำไรขาดทุนได้ */
    comparableDraws: number;
    mostProfitable: { name: string; cutoffAt: string; net: string } | null;
    leastProfitable: { name: string; cutoffAt: string; net: string } | null;
    rankedByNetDescending: { rank: number; name: string; cutoffAt: string; net: string }[];
  };
  drawHistory: {
    totalDraws: number;
    detailsTruncated: boolean;
    details: {
      name: string;
      status: string;
      cutoffAt: string;
      bills: number;
      sales: string;
      prizeExpense: string;
      /** null = รอบนี้ยังไม่ได้คำนวณ Settlement จึงยังไม่มีกำไรขาดทุน */
      commission: string | null;
      net: string | null;
      settlementCalculated: boolean;
    }[];
  };
  agentPerformance: {
    totalActiveAgents: number;
    detailsTruncated: boolean;
    details: {
      code: string;
      name: string;
      bills: number;
      sales: string;
      prizeExpense: string;
    }[];
  };
  currentDraw: {
    name: string;
    status: string;
    opensAt: string;
    cutoffAt: string;
    /** ลบ = เลยเวลาปิดรับมาแล้วกี่นาที */
    minutesUntilCutoff: number;
    bills: number;
    items: number;
    sales: string;
    prizeExpense: string;
    commission: string;
    net: string;
    /** เรียงตามจำนวนรายการก่อน แล้วใช้ยอดเดิมพันตัดสินเมื่อจำนวนเท่ากัน */
    highDemandNumbers: {
      rank: number;
      number: string;
      itemCount: number;
      stake: string;
    }[];
    prizeTypeDemand: {
      rank: number;
      prizeType: string;
      itemCount: number;
      stake: string;
    }[];
    winners: {
      /** จำนวนรายการที่ถูกรางวัลทั้งหมด อาจมากกว่าจำนวนรายละเอียดด้านล่าง */
      totalWinningItems: number;
      uniqueWinningCustomers: number;
      detailsTruncated: boolean;
      details: {
        customerReference: string;
        billNumber: string;
        prizeType: string;
        number: string;
        stake: string;
        payout: string;
      }[];
    };
    /** false = ยังไม่คำนวณ ตัวเลขจ่ายรางวัลและสุทธิจึงยังไม่สมบูรณ์ */
    settlementCalculated: boolean;
  } | null;
  winnerHistory: {
    totalWinningItems: number;
    detailsTruncated: boolean;
    details: {
      customerReference: string;
      billNumber: string;
      drawName: string;
      drawCutoffAt: string;
      prizeType: string;
      number: string;
      stake: string;
      payout: string;
    }[];
  };
  resultEntry: {
    activePrizeTypes: number;
    approved: number;
    remaining: number;
  };
  agents: { active: number };
  pendingWork: {
    evidenceReviews: number;
    settlementReviews: number;
    cancellationRequests: number;
    resultCorrections: number;
  };
};

const WINNER_DETAIL_LIMIT = 50;
const WINNER_HISTORY_LIMIT = 100;
const DRAW_HISTORY_LIMIT = 24;
const AGENT_PERFORMANCE_LIMIT = 10;
const COUNTED_BILL_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];

function minutesBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 60_000);
}

function summarizeHighDemandNumbers(
  items: { number: string; stake: { toString(): string } }[],
): NonNullable<OwnerSnapshot["currentDraw"]>["highDemandNumbers"] {
  const demand = new Map<string, { itemCount: number; stake: number }>();
  for (const item of items) {
    const current = demand.get(item.number) ?? { itemCount: 0, stake: 0 };
    current.itemCount += 1;
    current.stake += Number(item.stake);
    demand.set(item.number, current);
  }

  return [...demand.entries()]
    .sort(
      (left, right) =>
        right[1].itemCount - left[1].itemCount ||
        right[1].stake - left[1].stake ||
        left[0].localeCompare(right[0], "th-TH"),
    )
    .slice(0, 5)
    .map(([number, value], index) => ({
      rank: index + 1,
      number,
      itemCount: value.itemCount,
      stake: value.stake.toFixed(2),
    }));
}

function summarizePrizeTypeDemand(
  items: { stake: { toString(): string }; prizeType: { name: string } }[],
): NonNullable<OwnerSnapshot["currentDraw"]>["prizeTypeDemand"] {
  const demand = new Map<string, { itemCount: number; stake: number }>();
  for (const item of items) {
    const name = sanitizeLabel(item.prizeType.name);
    const current = demand.get(name) ?? { itemCount: 0, stake: 0 };
    current.itemCount += 1;
    current.stake += Number(item.stake);
    demand.set(name, current);
  }

  return [...demand.entries()]
    .map(([prizeType, value]) => ({ prizeType, ...value }))
    .sort(
      (left, right) =>
        right.stake - left.stake ||
        right.itemCount - left.itemCount ||
        left.prizeType.localeCompare(right.prizeType, "th-TH"),
    )
    .slice(0, 5)
    .map((row, index) => ({ ...row, rank: index + 1, stake: row.stake.toFixed(2) }));
}

export async function buildOwnerSnapshot(
  actor: Actor,
  now: Date = new Date(),
): Promise<OwnerSnapshot> {
  const scope = orgScope(actor);
  const countedBillWhere = {
    ...scope,
    status: { in: COUNTED_BILL_STATUSES },
  } satisfies Prisma.BillWhereInput;

  const [
    organization,
    latestDraw,
    activeAgents,
    evidenceReviews,
    cancellationRequests,
    winnerHistoryCount,
    winnerHistoryItems,
    overallDrawCount,
    overallBillTotals,
    overallItemCount,
    overallNumberDemand,
    overallCustomerGroups,
    overallWinningCustomers,
    overallPrizeDemand,
    allPrizeTypes,
    recentDraws,
    overallDrawGroups,
    overallAgentGroups,
    allAgents,
    billStatusGroups,
    settlementByDraw,
  ] =
    await Promise.all([
      prisma.organization.findUnique({
        where: { id: actor.organizationId },
        select: { name: true, timezone: true },
      }),
      prisma.draw.findFirst({
        where: scope,
        orderBy: { cutoffAt: "desc" },
        select: { id: true, name: true, opensAt: true, cutoffAt: true },
      }),
      prisma.agent.count({ where: { ...scope, status: "ACTIVE" } }),
      prisma.billAttachment.count({ where: { ...scope, status: "PENDING" } }),
      prisma.bill.count({
        where: { ...scope, cancelRequestedAt: { not: null }, cancelledAt: null },
      }),
      prisma.billItem.count({
        where: {
          ...scope,
          isWinner: true,
          bill: { ...scope, status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } },
        },
      }),
      prisma.billItem.findMany({
        where: {
          ...scope,
          isWinner: true,
          bill: { ...scope, status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: WINNER_HISTORY_LIMIT,
        select: {
          number: true,
          stake: true,
          payout: true,
          prizeType: { select: { name: true } },
          bill: {
            select: {
              title: true,
              billNumber: true,
              draw: { select: { name: true, cutoffAt: true } },
            },
          },
        },
      }),
      prisma.draw.count({ where: scope }),
      prisma.bill.aggregate({
        where: countedBillWhere,
        _count: { _all: true },
        _sum: { totalStake: true, totalPayout: true },
      }),
      prisma.billItem.count({ where: { bill: countedBillWhere } }),
      prisma.billItem.groupBy({
        by: ["number"],
        where: { bill: countedBillWhere },
        _count: { _all: true },
        _sum: { stake: true },
      }),
      prisma.bill.groupBy({
        by: ["title"],
        where: countedBillWhere,
        _count: { _all: true },
      }),
      prisma.bill.findMany({
        where: { ...countedBillWhere, items: { some: { isWinner: true } } },
        select: { title: true },
        distinct: ["title"],
      }),
      prisma.billItem.groupBy({
        by: ["prizeTypeId"],
        where: { bill: countedBillWhere },
        _count: { _all: true },
        _sum: { stake: true },
      }),
      prisma.prizeType.findMany({
        where: scope,
        select: { id: true, name: true },
      }),
      prisma.draw.findMany({
        where: scope,
        orderBy: [{ cutoffAt: "desc" }, { id: "desc" }],
        take: DRAW_HISTORY_LIMIT,
        select: { id: true, name: true, status: true, cutoffAt: true },
      }),
      prisma.bill.groupBy({
        by: ["drawId"],
        where: countedBillWhere,
        _count: { _all: true },
        _sum: { totalStake: true, totalPayout: true },
      }),
      prisma.bill.groupBy({
        by: ["agentId"],
        where: countedBillWhere,
        _count: { _all: true },
        _sum: { totalStake: true, totalPayout: true },
      }),
      prisma.agent.findMany({
        where: scope,
        select: { id: true, code: true, name: true },
      }),
      prisma.bill.groupBy({
        by: ["status"],
        where: scope,
        _count: { _all: true },
      }),
      // กำไรขาดทุนต่อรอบอ่านจาก Settlement ซึ่งเป็นแถวเดียวกับที่หน้ารายงานใช้
      // ไม่คำนวณเองจาก sales ลบ payout เพราะจะไม่หักคอมมิชชันและไม่ตรงกับระบบ
      prisma.settlement.groupBy({
        by: ["drawId"],
        where: scope,
        _sum: { gross: true, payout: true, commission: true, net: true },
      }),
    ]);

  const overallSales = Number(overallBillTotals._sum.totalStake ?? 0);
  const prizeTypeById = new Map(allPrizeTypes.map((prizeType) => [prizeType.id, prizeType.name]));
  const repeatCustomers = overallCustomerGroups.filter((row) => row._count._all > 1).length;
  const overallHighDemandNumbers = overallNumberDemand
    .map((row) => ({
      number: row.number,
      itemCount: row._count._all,
      stake: Number(row._sum.stake ?? 0),
    }))
    .sort(
      (left, right) =>
        right.itemCount - left.itemCount ||
        right.stake - left.stake ||
        left.number.localeCompare(right.number, "th-TH"),
    )
    .slice(0, 5)
    .map((row, index) => ({ ...row, rank: index + 1, stake: row.stake.toFixed(2) }));
  const overallPrizeTypeDemand = overallPrizeDemand
    .map((row) => ({
      prizeType: sanitizeLabel(prizeTypeById.get(row.prizeTypeId)),
      itemCount: row._count._all,
      stake: Number(row._sum.stake ?? 0),
    }))
    .sort((left, right) => right.stake - left.stake || right.itemCount - left.itemCount)
    .slice(0, 5)
    .map((row, index) => ({ ...row, rank: index + 1, stake: row.stake.toFixed(2) }));
  const drawTotalsById = new Map(overallDrawGroups.map((row) => [row.drawId, row]));
  const settlementByDrawId = new Map(settlementByDraw.map((row) => [row.drawId, row]));

  /**
   * กำไรขาดทุนรายรอบ
   *
   * net มาจาก Settlement ไม่ใช่ sales ลบ prizeExpense เพราะ net หักคอมมิชชันแล้ว
   * รอบที่ยังไม่คำนวณ Settlement จะไม่มี net จึงต้องแยกออกจากการจัดอันดับ
   * ไม่งั้นรอบที่ยังไม่คำนวณจะถูกนับเป็นกำไร 0 แล้วชนะรอบที่ขาดทุนจริง
   */
  const drawHistoryDetails = recentDraws.map((draw) => {
    const totals = drawTotalsById.get(draw.id);
    const settled = settlementByDrawId.get(draw.id);
    return {
      name: sanitizeLabel(draw.name),
      status: draw.status,
      cutoffAt: draw.cutoffAt.toISOString(),
      bills: totals?._count._all ?? 0,
      sales: Number(totals?._sum.totalStake ?? 0).toFixed(2),
      prizeExpense: Number(totals?._sum.totalPayout ?? 0).toFixed(2),
      commission: settled ? Number(settled._sum.commission ?? 0).toFixed(2) : null,
      net: settled ? Number(settled._sum.net ?? 0).toFixed(2) : null,
      settlementCalculated: settled !== undefined,
    };
  });

  // จัดอันดับให้เสร็จฝั่งเซิร์ฟเวอร์ โมเดลจะได้ไม่ต้องเรียงหรือเทียบตัวเลขเอง
  const rankedByNet = drawHistoryDetails
    .filter((draw) => draw.net !== null)
    .map((draw) => ({ name: draw.name, cutoffAt: draw.cutoffAt, net: draw.net! }))
    .sort((left, right) => Number(right.net) - Number(left.net));
  const profitability = {
    comparableDraws: rankedByNet.length,
    /** รอบที่กำไรสูงสุด = ยอดสุทธิมากที่สุด */
    mostProfitable: rankedByNet[0] ?? null,
    /** รอบที่ขาดทุนมากที่สุด = ยอดสุทธิน้อยที่สุด ติดลบมากที่สุด */
    leastProfitable: rankedByNet.length > 0 ? rankedByNet[rankedByNet.length - 1]! : null,
    rankedByNetDescending: rankedByNet.map((draw, index) => ({ rank: index + 1, ...draw })),
  };
  const agentById = new Map(allAgents.map((agent) => [agent.id, agent]));
  const agentPerformanceDetails = overallAgentGroups
    .map((row) => ({
      agent: agentById.get(row.agentId),
      bills: row._count._all,
      sales: Number(row._sum.totalStake ?? 0),
      prizeExpense: Number(row._sum.totalPayout ?? 0),
    }))
    .filter((row) => row.agent !== undefined)
    .sort((left, right) => right.sales - left.sales || right.bills - left.bills)
    .slice(0, AGENT_PERFORMANCE_LIMIT)
    .map((row) => ({
      code: row.agent!.code,
      name: sanitizeLabel(row.agent!.name),
      bills: row.bills,
      sales: row.sales.toFixed(2),
      prizeExpense: row.prizeExpense.toFixed(2),
    }));

  // งานค้างที่ผูกกับรอบล่าสุด นับแยกเพราะต้องรู้ drawId ก่อน
  const [
    summary,
    activePrizeTypes,
    approvedResults,
    resultCorrections,
    settlementReviews,
    demandItems,
    totalWinningItems,
    winnerItems,
    winningCustomers,
  ] =
    latestDraw
      ? await Promise.all([
          drawSummary(actor, latestDraw.id),
          prisma.prizeType.count({ where: { ...scope, isActive: true } }),
          // นับประเภทรางวัลที่มีผลอนุมัติแล้ว ไม่ใช่จำนวนแถว
          // เพราะการแก้ผลทำให้รางวัลเดียวมีแถว APPROVED มากกว่าหนึ่ง
          prisma.result
            .findMany({
              where: { drawId: latestDraw.id, ...scope, status: "APPROVED" },
              select: { prizeTypeId: true },
              distinct: ["prizeTypeId"],
            })
            .then((rows) => rows.length),
          prisma.result.count({
            where: { drawId: latestDraw.id, ...scope, status: "DRAFT", version: { gt: 1 } },
          }),
          prisma.settlement.count({ where: { drawId: latestDraw.id, ...scope, status: "DRAFT" } }),
          prisma.billItem.findMany({
            where: {
              ...scope,
              bill: {
                ...scope,
                drawId: latestDraw.id,
                status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] },
              },
            },
            select: {
              number: true,
              stake: true,
              prizeType: { select: { name: true } },
            },
          }),
          prisma.billItem.count({
            where: {
              ...scope,
              isWinner: true,
              bill: {
                ...scope,
                drawId: latestDraw.id,
                status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] },
              },
            },
          }),
          prisma.billItem.findMany({
            where: {
              ...scope,
              isWinner: true,
              bill: {
                ...scope,
                drawId: latestDraw.id,
                status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] },
              },
            },
            orderBy: [{ payout: "desc" }, { createdAt: "asc" }, { id: "asc" }],
            take: WINNER_DETAIL_LIMIT,
            select: {
              number: true,
              stake: true,
              payout: true,
              prizeType: { select: { name: true } },
              bill: { select: { title: true, billNumber: true } },
            },
          }),
          prisma.bill.findMany({
            where: {
              ...scope,
              drawId: latestDraw.id,
              status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] },
              items: { some: { isWinner: true } },
            },
            select: { title: true },
            distinct: ["title"],
          }),
        ])
      : [
          null,
          await prisma.prizeType.count({ where: { ...scope, isActive: true } }),
          0,
          0,
          0,
          [],
          0,
          [],
          [],
        ];

  const highDemandNumbers = summarizeHighDemandNumbers(demandItems);
  const currentPrizeTypeDemand = summarizePrizeTypeDemand(demandItems);

  return {
    generatedAt: now.toISOString(),
    organization: {
      name: sanitizeLabel(organization?.name),
      timezone: organization?.timezone ?? "Asia/Bangkok",
    },
    overall: {
      scopeLabel: "ทุกงวด เฉพาะบิลที่ยืนยันแล้ว ล็อกแล้ว หรือคำนวณแล้ว",
      draws: overallDrawCount,
      bills: overallBillTotals._count._all,
      items: overallItemCount,
      sales: overallSales.toFixed(2),
      prizeExpense: Number(overallBillTotals._sum.totalPayout ?? 0).toFixed(2),
      uniqueCustomers: overallCustomerGroups.length,
      repeatCustomers,
      repeatRatePercent: (
        overallCustomerGroups.length > 0
          ? repeatCustomers / overallCustomerGroups.length * 100
          : 0
      ).toFixed(2),
      averageBill: (
        overallBillTotals._count._all > 0
          ? overallSales / overallBillTotals._count._all
          : 0
      ).toFixed(2),
      winningCustomers: overallWinningCustomers.length,
      highDemandNumbers: overallHighDemandNumbers,
      prizeTypeDemand: overallPrizeTypeDemand,
      billStatusCounts: billStatusGroups.map((row) => ({
        status: row.status,
        count: row._count._all,
      })),
    },
    profitability,
    drawHistory: {
      totalDraws: overallDrawCount,
      detailsTruncated: overallDrawCount > drawHistoryDetails.length,
      details: drawHistoryDetails,
    },
    agentPerformance: {
      totalActiveAgents: activeAgents,
      detailsTruncated: overallAgentGroups.length > agentPerformanceDetails.length,
      details: agentPerformanceDetails,
    },
    currentDraw:
      latestDraw && summary
        ? {
            name: sanitizeLabel(latestDraw.name),
            status: summary.drawStatus,
            opensAt: latestDraw.opensAt.toISOString(),
            cutoffAt: latestDraw.cutoffAt.toISOString(),
            minutesUntilCutoff: minutesBetween(now, latestDraw.cutoffAt),
            bills: summary.billCount,
            items: summary.itemCount,
            sales: summary.gross.toFixed(2),
            prizeExpense: summary.payout.toFixed(2),
            commission: summary.commission.toFixed(2),
            net: summary.net.toFixed(2),
            highDemandNumbers,
            prizeTypeDemand: currentPrizeTypeDemand,
            winners: {
              totalWinningItems,
              uniqueWinningCustomers: winningCustomers.length,
              detailsTruncated: totalWinningItems > winnerItems.length,
              details: winnerItems.map((item) => ({
                customerReference: sanitizeLabel(item.bill.title),
                billNumber: item.bill.billNumber ?? "ไม่ระบุ",
                prizeType: sanitizeLabel(item.prizeType.name),
                number: item.number,
                stake: item.stake.toFixed(2),
                payout: item.payout.toFixed(2),
              })),
            },
            settlementCalculated: !summary.pendingSettlement,
          }
        : null,
    winnerHistory: {
      totalWinningItems: winnerHistoryCount,
      detailsTruncated: winnerHistoryCount > winnerHistoryItems.length,
      details: winnerHistoryItems.map((item) => ({
        customerReference: sanitizeLabel(item.bill.title),
        billNumber: item.bill.billNumber ?? "ไม่ระบุ",
        drawName: sanitizeLabel(item.bill.draw.name),
        drawCutoffAt: item.bill.draw.cutoffAt.toISOString(),
        prizeType: sanitizeLabel(item.prizeType.name),
        number: item.number,
        stake: item.stake.toFixed(2),
        payout: item.payout.toFixed(2),
      })),
    },
    resultEntry: {
      activePrizeTypes,
      approved: approvedResults,
      remaining: Math.max(0, activePrizeTypes - approvedResults),
    },
    agents: { active: activeAgents },
    pendingWork: {
      evidenceReviews,
      settlementReviews,
      cancellationRequests,
      resultCorrections,
    },
  };
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { BetSlip, type SlipLottery, type SlipRepresentative, type SlipRestriction } from "./BetSlip";
import { fullNumbersByDraw } from "@/lib/draws/number-cap";
import { drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { billSequencePeriod } from "@/lib/bills/numbering";
import { LAO_SET_ACTIVE_CODES } from "@/lib/lao/rules";
import { buildLaoSetPayoutRows, LAO_SET_PAYOUT_COLUMNS } from "@/lib/lao/set-package-rates";
import { LotteryTypePicker } from "./LotteryTypePicker";
import "./new-bill.css";
import "./bet-slip.css";

export const dynamic = "force-dynamic";

const CUTOFF_LABEL = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Bangkok",
});

const ROLE_LABEL = { OWNER: "Owner", ADMIN: "Admin", AGENT: "Agent" } as const;
type NewBillSearchParams = { lottery?: string | string[] };
type SupportedLottery = "THAI_GOVERNMENT" | "LAO" | "LAO_SET";
const SUPPORTED: readonly SupportedLottery[] = ["THAI_GOVERNMENT", "LAO", "LAO_SET"];

function first(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

/**
 * หน้าสร้างบิล ใช้หน้าเดียวกันทุกบทบาท
 *
 * โหลดเฉพาะสิ่งที่ต้องใช้ตอนเปิดหน้า (งวด รางวัล เลขเต็ม/อั้น ผู้รับบิล)
 * ชื่อลูกค้าเดิมและโพยเดิมโหลดผ่าน /api/bills/slip-data ภายหลัง
 * เดิมหน้านี้ดึงบิลถึง 5,000 ใบพร้อมรายการเลขทุกครั้งที่เปิด
 */
export default async function NewBillPage({ searchParams }: { searchParams: Promise<NewBillSearchParams> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "bill.create")) redirect("/bills");

  const query = await searchParams;
  const rawLottery = first(query.lottery);
  const selectedLottery = SUPPORTED.find((value) => value === rawLottery);
  const drawSelect = { id: true, name: true, drawDate: true, lotteryType: true, cutoffAt: true, status: true, numberCap: true } as const;
  const allOpenDraws = await prisma.draw.findMany({
    where: { ...orgScope(actor), lotteryType: { in: [...SUPPORTED] }, status: "OPEN", cutoffAt: { gt: new Date() } },
    orderBy: { cutoffAt: "asc" },
    take: 36,
    select: drawSelect,
  });
  if (!selectedLottery) {
    const firstOf = (type: SupportedLottery) => {
      const draw = allOpenDraws.find((row) => row.lotteryType === type);
      return draw ? { dateLabel: drawDateLabel(draw), cutoffAt: draw.cutoffAt.toISOString(), cutoffLabel: CUTOFF_LABEL.format(draw.cutoffAt) } : null;
    };
    const thaiDraw = allOpenDraws.find((row) => row.lotteryType === "THAI_GOVERNMENT");
    return (
      <main className="workspace-page new-bill-page bet-slip-page">
        <nav className="bs-breadcrumb" aria-label="ตำแหน่งหน้า">
          <Link href="/">หน้าหลัก</Link><span aria-hidden="true">/</span><Link href="/bills">รายการบิล</Link><span aria-hidden="true">/</span><span>เลือกประเภทหวย</span>
        </nav>
        <LotteryTypePicker thaiDraw={thaiDraw ? {
          dateLabel: drawDateLabel(thaiDraw),
          cutoffAt: thaiDraw.cutoffAt.toISOString(),
          cutoffLabel: CUTOFF_LABEL.format(thaiDraw.cutoffAt),
        } : null} laoDraw={firstOf("LAO")} laoSetDraw={firstOf("LAO_SET")} />
      </main>
    );
  }

  // บิลเดียวเพิ่มได้ทุกประเภทหวย จึงแสดงครบทั้ง 3 แท็บเสมอ
  // ถ้าประเภทใดยังไม่มีงวดเปิดรับ จะแสดงงวดล่าสุดเป็นสถานะปิดรับแทนการซ่อนแท็บ
  // ผู้ใช้จึงเข้าใจได้ทันทีว่าประเภทนั้นมีในระบบ แต่ต้องรอสร้าง/เปิดงวดก่อนจึงแทงได้
  const slipTypes = [...SUPPORTED];
  const missingOpenTypes = slipTypes.filter((type) => !allOpenDraws.some((draw) => draw.lotteryType === type));
  const latestMissingDraws = await Promise.all(missingOpenTypes.map((type) => prisma.draw.findFirst({
    where: { ...orgScope(actor), lotteryType: type },
    orderBy: { cutoffAt: "desc" },
    select: drawSelect,
  })));
  const fallbackByType = new Map(latestMissingDraws.filter((draw) => draw !== null).map((draw) => [draw.lotteryType, draw] as const));
  const drawsByType = new Map(slipTypes.map((type) => {
    const open = allOpenDraws.filter((draw) => draw.lotteryType === type);
    const fallback = fallbackByType.get(type);
    return [type, open.length > 0 ? open : fallback ? [fallback] : []] as const;
  }));
  const selectedDraws = drawsByType.get(selectedLottery) ?? [];
  const draws = [...drawsByType.values()].flat();
  const drawIds = draws.map((draw) => draw.id);
  const counterPeriods = drawIds.map(billSequencePeriod);
  const [prizeTypes, representatives, ownAgent, laoSetRateRows, existingSequences] = await Promise.all([
    prisma.prizeType.findMany({
      where: {
        ...orgScope(actor),
        isActive: true,
        // หวยลาวชุดรับเฉพาะประเภทที่เปิดขาย (LAO_SET_ACTIVE_CODES)
        OR: [
          { lotteryType: { in: slipTypes.filter((type) => type !== "LAO_SET") } },
          ...(slipTypes.includes("LAO_SET") ? [{ lotteryType: "LAO_SET" as const, code: { in: [...LAO_SET_ACTIVE_CODES] } }] : []),
        ],
      },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, digits: true, matchRule: true, payoutRate: true, lotteryType: true },
    }),
    actor.role === "AGENT"
      ? Promise.resolve(null)
      : prisma.user.findMany({
          where: {
            ...orgScope(actor),
            status: "ACTIVE",
            role: { in: actor.role === "OWNER" ? ["OWNER", "ADMIN", "AGENT"] : ["ADMIN", "AGENT"] },
            OR: [{ agent: null }, { agent: { status: "ACTIVE" } }],
          },
          orderBy: [{ role: "asc" }, { displayName: "asc" }],
          select: {
            id: true,
            displayName: true,
            role: true,
            agent: {
              select: {
                id: true,
                code: true,
                commissionRate: true,
                billCounters: { where: { period: { in: counterPeriods } }, select: { period: true, lastSequence: true } },
              },
            },
          },
        }),
    actor.agentId
      ? prisma.agent.findUnique({
          where: { id: actor.agentId },
          select: {
            id: true,
            commissionRate: true,
            billCounters: { where: { period: { in: counterPeriods } }, select: { period: true, lastSequence: true } },
          },
        })
      : Promise.resolve(null),
    prisma.prizeType.findMany({
      where: { ...orgScope(actor), lotteryType: "LAO_SET", code: { in: LAO_SET_PAYOUT_COLUMNS.map((column) => column.code) } },
      select: { code: true, payoutRate: true },
    }),
    prisma.bill.groupBy({
      by: ["agentId", "drawId"],
      where: { ...orgScope(actor), drawId: { in: drawIds }, drawSequence: { not: null } },
      _max: { drawSequence: true },
    }),
  ]);

  const laoSetRateByCode = new Map(laoSetRateRows.map((row) => [row.code, row.payoutRate.toNumber()]));
  const laoSetPayouts = buildLaoSetPayoutRows((code) => laoSetRateByCode.get(code) ?? 0);

  const restrictionRows = draws.length === 0 ? [] : await prisma.restrictedNumber.findMany({
    where: { ...orgScope(actor), drawId: { in: draws.map((draw) => draw.id) } },
    select: { drawId: true, prizeTypeId: true, number: true, kind: true, payoutRate: true },
  });
  const restrictions: Record<string, SlipRestriction[]> = {};
  for (const row of restrictionRows) {
    (restrictions[row.drawId] ??= []).push({
      prizeTypeId: row.prizeTypeId,
      number: row.number,
      kind: row.kind,
      payoutRate: row.payoutRate?.toFixed(4) ?? null,
    });
  }
  // เลขที่ยอดครบเพดานแล้วถือเป็นเลขเต็ม ใส่ทีหลังเพื่อทับเลขอั้นของเลขเดียวกัน
  // หน้าแทงจะเตือนทันที ส่วนการตัดสินจริงทำซ้ำฝั่ง Server ตอนยืนยันบิล
  const fullByDraw = await fullNumbersByDraw(prisma, actor.organizationId, draws.filter((draw) => draw.status === "OPEN"));
  for (const [drawId, rows] of fullByDraw) {
    for (const row of rows) {
      (restrictions[drawId] ??= []).push({ prizeTypeId: row.prizeTypeId, number: row.number, kind: "CLOSED", payoutRate: null });
    }
  }


  const historicalByAgentDraw = new Map(existingSequences.map((row) => [`${row.agentId}:${row.drawId}`, row._max.drawSequence ?? 0]));
  const nextByDraw = (agent: { id: string; billCounters: { period: string; lastSequence: number }[] } | null) => Object.fromEntries(drawIds.map((drawId) => [
    drawId,
    agent ? Math.max(agent.billCounters.find((counter) => counter.period === billSequencePeriod(drawId))?.lastSequence ?? 0, historicalByAgentDraw.get(`${agent.id}:${drawId}`) ?? 0) + 1 : 1,
  ]));

  const slipRepresentatives: SlipRepresentative[] | null = representatives?.map((user) => ({
    id: user.id,
    displayName: user.displayName,
    roleLabel: ROLE_LABEL[user.role],
    agentCode: user.agent?.code ?? null,
    commissionRate: user.agent ? user.agent.commissionRate.toFixed(4) : null,
    nextBillSequenceByDraw: nextByDraw(user.agent),
  })) ?? null;

  return (
    <main className="workspace-page new-bill-page bet-slip-page">
      <nav className="bs-breadcrumb" aria-label="ตำแหน่งหน้า">
        <Link href="/">หน้าหลัก</Link><span aria-hidden="true">/</span><Link href="/bills">รายการบิล</Link><span aria-hidden="true">/</span><span>สร้างบิลใหม่</span>
      </nav>
      {selectedDraws.length === 0 ? (
        <p className="error">ยังไม่มีงวดในระบบ</p>
      ) : (
        <BetSlip
          lotteries={slipTypes.map((type): SlipLottery => ({
            type,
            label: lotteryLabel(type),
            flag: type === "THAI_GOVERNMENT" ? "TH" : "LA",
            draws: (drawsByType.get(type) ?? []).map((draw) => ({
              id: draw.id,
              lotteryType: draw.lotteryType,
              lotteryLabel: lotteryLabel(draw.lotteryType),
              flag: draw.lotteryType === "THAI_GOVERNMENT" ? "TH" : "LA",
              dateLabel: drawDateLabel(draw),
              cutoffAt: draw.cutoffAt.toISOString(),
              cutoffLabel: CUTOFF_LABEL.format(draw.cutoffAt),
              open: draw.status === "OPEN" && draw.cutoffAt.getTime() > Date.now(),
            })),
            prizeTypes: prizeTypes
              .filter((prizeType) => prizeType.lotteryType === type)
              .map(({ lotteryType: _lotteryType, ...prizeType }) => ({ ...prizeType, payoutRate: prizeType.payoutRate.toFixed(4) })),
          })).filter((item) => item.draws.length > 0 && item.prizeTypes.length > 0)}
          initialLottery={selectedLottery}
          laoSetPayouts={laoSetPayouts}
          restrictions={restrictions}
          representatives={slipRepresentatives}
          ownCommissionRate={ownAgent ? ownAgent.commissionRate.toFixed(4) : null}
          ownNextBillSequenceByDraw={nextByDraw(ownAgent)}
          serverNow={Date.now()}
          // ร่างเดียวต่อผู้ใช้ เพราะบิลเดียวรวมได้หลายประเภทหวย
          draftScope={`${actor.userId}:slip`}
        />
      )}
    </main>
  );
}

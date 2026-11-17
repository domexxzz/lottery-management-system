import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { compactRate } from "@/lib/bills/betting";
import { parseHistoryFilter, type HistoryParams } from "@/lib/bills/history-filter";
import { resolveHistoryScope } from "@/lib/bills/history-scope";
import { fullNumbersByDraw } from "@/lib/draws/number-cap";
import { listExposure, type ExposureRow } from "@/lib/draws/number-exposure";
import { AgentBillBoard, type RestrictionAnnouncement } from "./AgentBillBoard";
import "./slip-board.css";

export const dynamic = "force-dynamic";

const ANNOUNCE_DRAW_SELECT = { id: true, name: true, drawDate: true, opensAt: true, cutoffAt: true, numberCap: true, lotteryType: true, status: true } as const;

export default async function BillsPage({ searchParams }: { searchParams: Promise<HistoryParams> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const filter = parseHistoryFilter(await searchParams);
  const canSeeAllAgents = can(actor.role, "report.viewAllAgents");

  // ขอบเขตงวด (ค่าเริ่มต้นคืองวดปัจจุบันที่ต้องทำ) และ Agent ที่ยังใช้งานสำหรับตัวกรอง
  const [scope, agents, openDraws] = await Promise.all([
    resolveHistoryScope(actor, filter),
    canSeeAllAgents
      ? prisma.agent.findMany({
          where: { ...orgScope(actor), status: { not: "CLOSED" } },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve(null),
    prisma.draw.findMany({
      where: {
        ...orgScope(actor),
        status: "OPEN",
        cutoffAt: { gt: new Date() },
        ...(filter.lotteryType ? { lotteryType: filter.lotteryType } : {}),
      },
      orderBy: { cutoffAt: "asc" },
      select: ANNOUNCE_DRAW_SELECT,
    }),
  ]);

  // ประกาศตามประเภทหวยและงวดที่เลือก: เลือกงวดแล้วประกาศเฉพาะงวดนั้น ไม่งั้นทุกงวดที่เปิดรับของประเภทที่เลือก
  const pinnedDrawId = scope.drawId;
  const announceDraws = pinnedDrawId
    ? openDraws.some((draw) => draw.id === pinnedDrawId)
      ? openDraws.filter((draw) => draw.id === pinnedDrawId)
      : await prisma.draw.findMany({ where: { ...orgScope(actor), id: pinnedDrawId }, select: ANNOUNCE_DRAW_SELECT })
    : openDraws;
  const drawIds = announceDraws.map((draw) => draw.id);
  const [restrictedNumbers, fullByDraw, topByDraw] = drawIds.length === 0
    ? [[], new Map(), new Map<string, ExposureRow[]>()]
    : await Promise.all([
        prisma.restrictedNumber.findMany({
          where: { ...orgScope(actor), drawId: { in: drawIds } },
          orderBy: [{ prizeType: { code: "asc" } }, { number: "asc" }],
          select: {
            id: true,
            drawId: true,
            number: true,
            kind: true,
            payoutRate: true,
            prizeType: { select: { name: true, payoutRate: true } },
          },
        }),
        fullNumbersByDraw(prisma, actor.organizationId, announceDraws),
        // 5 อันดับเลขที่มีคนซื้อมากที่สุด (รวมทุก Agent) ใช้เป็น "เลขใกล้เต็ม" เหมือนหน้าภาพรวม
        Promise.all(announceDraws.map(async (draw) => [
          draw.id,
          (await listExposure(prisma, { drawId: draw.id, cap: draw.numberCap, organizationId: actor.organizationId }, { sort: "used", direction: "desc", pageSize: 5 })).rows,
        ] as const)).then((entries) => new Map(entries)),
      ]);

  // เลขอั้นและเลขเต็มแยกกล่อง เลขเต็มรวมทั้งเลขที่ยอดครบเพดานและเลขที่ตั้งปิดไว้เอง
  const announcements: RestrictionAnnouncement[] = announceDraws.map((draw) => {
    const rows = restrictedNumbers.filter((row) => row.drawId === draw.id);
    const autoFull = [...(fullByDraw.get(draw.id) ?? [])]
      .sort((a, b) => a.prizeTypeCode - b.prizeTypeCode || a.number.localeCompare(b.number))
      .map((row) => ({
        id: `cap:${row.prizeTypeId}:${row.number}`,
        number: row.number,
        prizeTypeName: row.prizeTypeName,
      }));
    const fullByNumber = new Map<string, { id: string; number: string; prizeTypeName: string }>();
    for (const entry of [
      ...rows.filter((row) => row.kind === "CLOSED").map((row) => ({ id: row.id, number: row.number, prizeTypeName: row.prizeType.name })),
      ...autoFull,
    ]) if (!fullByNumber.has(entry.number)) fullByNumber.set(entry.number, entry);
    const top = topByDraw.get(draw.id) ?? [];
    return {
      drawId: draw.id,
      drawName: draw.name,
      lotteryType: draw.lotteryType,
      open: draw.status === "OPEN" && draw.cutoffAt.getTime() > Date.now(),
      drawDate: draw.drawDate,
      opensAt: draw.opensAt,
      cutoffAt: draw.cutoffAt,
      reduced: rows
        .filter((row) => row.kind === "REDUCED_RATE")
        .map((row) => ({
          id: row.id,
          number: row.number,
          prizeTypeName: row.prizeType.name,
          payoutRate: row.payoutRate ? compactRate(row.payoutRate) : "-",
          normalRate: compactRate(row.prizeType.payoutRate),
        })),
      full: [...fullByNumber.values()],
      near: top.map((row) => ({
        id: `top:${row.prizeTypeId}:${row.number}`,
        number: row.number,
        prizeTypeName: row.prizeTypeName,
        used: Number(row.used).toLocaleString("th-TH", { maximumFractionDigits: 2 }),
      })),
    };
  });

  return (
    <main className="workspace-page bills-page slip-board-page">
      <AgentBillBoard
        actor={actor}
        filter={filter}
        scope={scope}
        agents={agents?.map((agent) => ({ value: agent.id, label: `${agent.code} ${agent.name}` })) ?? null}
        announcements={announcements}
      />
    </main>
  );
}

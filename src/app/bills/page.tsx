import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { compactRate } from "@/lib/bills/betting";
import { parseHistoryFilter, type HistoryParams } from "@/lib/bills/history-filter";
import { resolveHistoryScope } from "@/lib/bills/history-scope";
import { capLabel, capStatusByDraw, type CapStatus } from "@/lib/draws/number-cap";
import { AgentBillBoard, type RestrictionAnnouncement } from "./AgentBillBoard";
import "./slip-board.css";

export const dynamic = "force-dynamic";

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
      where: { ...orgScope(actor), status: "OPEN", cutoffAt: { gt: new Date() } },
      orderBy: { cutoffAt: "asc" },
      select: { id: true, name: true, drawDate: true, opensAt: true, cutoffAt: true, numberCap: true },
    }),
  ]);

  const drawIds = openDraws.map((draw) => draw.id);
  const [restrictedNumbers, capByDraw] = drawIds.length === 0
    ? [[], new Map<string, CapStatus>()]
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
        capStatusByDraw(prisma, actor.organizationId, openDraws),
      ]);

  // เลขอั้นและเลขเต็มแยกกล่อง เลขเต็มรวมทั้งเลขที่ยอดครบเพดานและเลขที่ตั้งปิดไว้เอง
  const announcements: RestrictionAnnouncement[] = openDraws.map((draw) => {
    const rows = restrictedNumbers.filter((row) => row.drawId === draw.id);
    const cap = draw.numberCap ? capLabel(draw.numberCap) : null;
    const capStatus = capByDraw.get(draw.id);
    const autoFull = [...(capStatus?.full ?? [])]
      .sort((a, b) => a.prizeTypeCode - b.prizeTypeCode || a.number.localeCompare(b.number))
      .map((row) => ({
        id: `cap:${row.prizeTypeId}:${row.number}`,
        number: row.number,
        prizeTypeName: row.prizeTypeName,
        note: `ยอดครบ ${cap} บาท`,
      }));
    return {
      drawId: draw.id,
      drawName: draw.name,
      drawDate: draw.drawDate,
      opensAt: draw.opensAt,
      cutoffAt: draw.cutoffAt,
      capLabel: cap,
      reduced: rows
        .filter((row) => row.kind === "REDUCED_RATE")
        .map((row) => ({
          id: row.id,
          number: row.number,
          prizeTypeName: row.prizeType.name,
          payoutRate: row.payoutRate ? compactRate(row.payoutRate) : "-",
          normalRate: compactRate(row.prizeType.payoutRate),
        })),
      full: [
        ...rows
          .filter((row) => row.kind === "CLOSED")
          .map((row) => ({ id: row.id, number: row.number, prizeTypeName: row.prizeType.name, note: "ปิดรับเลขนี้" })),
        ...autoFull,
      ],
      fullTotal: (capStatus?.summary.full ?? 0) + rows.filter((row) => row.kind === "CLOSED").length,
      nearTotal: capStatus?.summary.near ?? 0,
      near: (capStatus?.near ?? []).map((row) => ({
        id: `near:${row.prizeTypeId}:${row.number}`,
        number: row.number,
        prizeTypeName: row.prizeTypeName,
        remaining: Number(row.remaining ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 2 }),
        percent: row.percent ?? 0,
      })),
    };
  }).filter((announcement) => announcement.reduced.length + announcement.full.length + announcement.near.length > 0);

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

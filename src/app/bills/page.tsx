import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { compactRate } from "@/lib/bills/betting";
import { parseHistoryFilter, type HistoryParams } from "@/lib/bills/history-filter";
import { resolveHistoryScope } from "@/lib/bills/history-scope";
import { AgentBillBoard } from "./AgentBillBoard";
import "./slip-board.css";

export const dynamic = "force-dynamic";

export default async function BillsPage({ searchParams }: { searchParams: Promise<HistoryParams> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const filter = parseHistoryFilter(await searchParams);
  const canSeeAllAgents = can(actor.role, "report.viewAllAgents");

  // ขอบเขตงวด (ค่าเริ่มต้นคืองวดปัจจุบันที่ต้องทำ) และ Agent ที่ยังใช้งานสำหรับตัวกรอง
  const [scope, agents, restrictedNumbers] = await Promise.all([
    resolveHistoryScope(actor, filter),
    canSeeAllAgents
      ? prisma.agent.findMany({
          where: { ...orgScope(actor), status: { not: "CLOSED" } },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve(null),
    prisma.restrictedNumber.findMany({
      where: {
        ...orgScope(actor),
        draw: { status: "OPEN", cutoffAt: { gt: new Date() } },
      },
      orderBy: [{ draw: { cutoffAt: "asc" } }, { prizeType: { code: "asc" } }, { number: "asc" }],
      select: {
        id: true,
        number: true,
        kind: true,
        payoutRate: true,
        draw: { select: { id: true, name: true, drawDate: true, opensAt: true, cutoffAt: true } },
        prizeType: { select: { name: true } },
      },
    }),
  ]);

  const announcements = new Map<string, {
    drawId: string;
    drawName: string;
    drawDate: Date | null;
    opensAt: Date;
    cutoffAt: Date;
    entries: { id: string; number: string; kind: "CLOSED" | "REDUCED_RATE"; payoutRate: string | null; prizeTypeName: string }[];
  }>();
  for (const row of restrictedNumbers) {
    const group = announcements.get(row.draw.id) ?? {
      drawId: row.draw.id,
      drawName: row.draw.name,
      drawDate: row.draw.drawDate,
      opensAt: row.draw.opensAt,
      cutoffAt: row.draw.cutoffAt,
      entries: [],
    };
    group.entries.push({
      id: row.id,
      number: row.number,
      kind: row.kind,
      payoutRate: row.payoutRate ? compactRate(row.payoutRate) : null,
      prizeTypeName: row.prizeType.name,
    });
    announcements.set(row.draw.id, group);
  }

  return (
    <main className="workspace-page bills-page slip-board-page">
      <AgentBillBoard
        actor={actor}
        filter={filter}
        scope={scope}
        agents={agents?.map((agent) => ({ value: agent.id, label: `${agent.code} ${agent.name}` })) ?? null}
        announcements={[...announcements.values()]}
      />
    </main>
  );
}

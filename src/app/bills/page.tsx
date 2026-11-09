import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { drawDateLabel } from "@/lib/bills/betting";
import { parseHistoryFilter, type HistoryParams } from "@/lib/bills/history-filter";
import { AgentBillBoard } from "./AgentBillBoard";
import "./slip-board.css";

export const dynamic = "force-dynamic";

export default async function BillsPage({ searchParams }: { searchParams: Promise<HistoryParams> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const filter = parseHistoryFilter(await searchParams);
  const canSeeAllAgents = can(actor.role, "report.viewAllAgents");

  // ตัวเลือกในตัวกรองเป็นรายการสั้น ๆ: งวดล่าสุด 24 งวด และ Agent ที่ยังใช้งาน
  const [draws, agents] = await Promise.all([
    prisma.draw.findMany({
      where: orgScope(actor),
      orderBy: { cutoffAt: "desc" },
      take: 24,
      select: { id: true, name: true, drawDate: true },
    }),
    canSeeAllAgents
      ? prisma.agent.findMany({
          where: { ...orgScope(actor), status: { not: "CLOSED" } },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <main className="workspace-page bills-page slip-board-page">
      <AgentBillBoard
        actor={actor}
        filter={filter}
        draws={draws.map((draw) => ({ value: draw.id, label: `งวด ${drawDateLabel(draw)}` }))}
        agents={agents?.map((agent) => ({ value: agent.id, label: `${agent.code} ${agent.name}` })) ?? null}
      />
    </main>
  );
}

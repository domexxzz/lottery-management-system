import type { BillStatus } from "@prisma/client";
import { orgScope, requirePermission, type Actor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { aggregateAgentCustomers } from "./customer-aggregation";

const COUNTED_STATUSES: BillStatus[] = ["CONFIRMED", "LOCKED", "SETTLED"];

export async function listAgentCustomers(actor: Actor, agentId: string, drawId?: string) {
  requirePermission(actor, "report.viewAllAgents");
  const scope = orgScope(actor);
  const agent = await prisma.agent.findFirst({
    where: { ...scope, id: agentId },
    select: { id: true, code: true, name: true },
  });
  if (!agent) throw new NotFoundError("ไม่พบ Agent");

  const bills = await prisma.bill.findMany({
    where: {
      ...scope,
      agentId: agent.id,
      status: { in: COUNTED_STATUSES },
      ...(drawId ? { drawId } : {}),
    },
    select: { title: true, totalStake: true, totalPayout: true, createdAt: true },
  });

  return { agent, customers: aggregateAgentCustomers(bills) };
}

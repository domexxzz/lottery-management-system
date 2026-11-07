import Link from "next/link";
import { redirect } from "next/navigation";
import { billScope, getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { BillForm } from "./BillForm";
import "./new-bill.css";

export const dynamic = "force-dynamic";

const BANGKOK = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export default async function NewBillPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (!can(actor.role, "bill.create")) redirect("/bills");

  const [draws, prizeTypes, representatives, historicalBills] = await Promise.all([
    prisma.draw.findMany({
      where: { ...orgScope(actor), status: "OPEN" },
      orderBy: { cutoffAt: "asc" },
      select: { id: true, name: true, cutoffAt: true },
    }),
    prisma.prizeType.findMany({
      where: { ...orgScope(actor), isActive: true },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true, digits: true },
    }),
    actor.role === "AGENT"
      ? Promise.resolve(null)
      : prisma.user.findMany({
          where: {
            ...orgScope(actor),
            status: "ACTIVE",
            role: { in: actor.role === "OWNER" ? ["OWNER", "ADMIN", "AGENT"] : ["ADMIN", "AGENT"] },
          },
          orderBy: [{ role: "asc" }, { displayName: "asc" }],
          select: {
            id: true,
            displayName: true,
            role: true,
            agent: { select: { id: true, code: true, name: true, status: true } },
          },
        }),
    prisma.bill.findMany({
      where: actor.role === "AGENT" ? billScope(actor) : orgScope(actor),
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: { agentId: true, title: true, agent: { select: { userId: true } } },
    }),
  ]);

  const customerNamesByRepresentative: Record<string, string[]> = {};
  const seenByRepresentative = new Map<string, Set<string>>();
  for (const bill of historicalBills) {
    const representativeKey = actor.role === "AGENT" ? bill.agentId : bill.agent.userId;
    if (!representativeKey) continue;
    const title = bill.title.trim();
    if (!title) continue;
    const seen = seenByRepresentative.get(representativeKey) ?? new Set<string>();
    const normalized = title.toLocaleLowerCase("th-TH");
    if (seen.has(normalized) || seen.size >= 100) continue;
    seen.add(normalized);
    seenByRepresentative.set(representativeKey, seen);
    (customerNamesByRepresentative[representativeKey] ??= []).push(title);
  }

  return (
    <main className="workspace-page new-bill-page">
      <section className="card workspace-card" aria-labelledby="new-bill-heading">
        <p><Link href="/bills">← กลับไปรายการบิล</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Create Bill</p><h1 id="new-bill-heading">สร้างบิลใหม่</h1><p>เลือกงวด เจ้าของบิล และเพิ่มรายการรับแทงอย่างเป็นขั้นตอน</p></div></header>

        {draws.length === 0 ? (
          <p className="error">ยังไม่มีงวดที่เปิดรับรายการ</p>
        ) : (
          <BillForm
            draws={draws.map((d) => ({
              id: d.id,
              name: d.name,
              cutoffAt: BANGKOK.format(d.cutoffAt),
            }))}
            prizeTypes={prizeTypes}
            representatives={representatives}
            currentRepresentativeId={actor.role === "AGENT" ? actor.agentId : actor.userId}
            customerNamesByRepresentative={customerNamesByRepresentative}
          />
        )}
      </section>
    </main>
  );
}

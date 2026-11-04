import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
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

  const [draws, prizeTypes, agents] = await Promise.all([
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
      : prisma.agent.findMany({
          where: { ...orgScope(actor), status: "ACTIVE" },
          orderBy: [{ code: "asc" }, { name: "asc" }],
          select: { id: true, code: true, name: true },
        }),
  ]);

  return (
    <main className="workspace-page new-bill-page">
      <section className="card workspace-card" aria-labelledby="new-bill-heading">
        <p><Link href="/bills">← กลับไปรายการบิล</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Create Bill</p><h1 id="new-bill-heading">สร้างบิลใหม่</h1><p>เลือกรอบ เจ้าของบิล และเพิ่มรายการรับแทงอย่างเป็นขั้นตอน</p></div></header>

        {draws.length === 0 ? (
          <p className="error">ยังไม่มีรอบที่เปิดรับรายการ</p>
        ) : (
          <BillForm
            draws={draws.map((d) => ({
              id: d.id,
              name: d.name,
              cutoffAt: BANGKOK.format(d.cutoffAt),
            }))}
            prizeTypes={prizeTypes}
            agents={agents}
          />
        )}
      </section>
    </main>
  );
}

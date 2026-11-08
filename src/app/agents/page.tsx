import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { getOrganizationMapData } from "@/lib/agents/organization-map";
import { customerProfileKey } from "@/lib/customers/profile-key";
import { prisma } from "@/lib/db";
import { DashboardIcon } from "../DashboardIcon";
import { OrganizationMap, type OrganizationAgentNode } from "./OrganizationMap";
import "./agents.css";

export const dynamic = "force-dynamic";

const MONEY = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });

export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/");

  const query = await searchParams;
  const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
  const drawId = first(query.drawId);
  const selectedAllDraws = !drawId || drawId === "all";
  const drawOptions = await prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: { cutoffAt: "desc" },
    select: { id: true, name: true, status: true },
  });
  const organization = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { name: true },
  });
  const defaultDraw = drawOptions.find((draw) => ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED"].includes(draw.status)) ?? drawOptions[0] ?? null;
  const currentDraw = selectedAllDraws ? null : (drawOptions.find((draw) => draw.id === drawId) ?? defaultDraw);

  const mapData = await getOrganizationMapData(actor, currentDraw?.id);
  const performance = new Map(mapData.stats.map((row) => [row.agentId, row]));
  const customerRows = new Map<string, typeof mapData.topCustomers>();
  const customerCounts = new Map<string, number>();
  for (const customer of mapData.topCustomers) {
    const rows = customerRows.get(customer.agentId) ?? [];
    rows.push(customer);
    customerRows.set(customer.agentId, rows);
    customerCounts.set(customer.agentId, customer.customerCount);
  }

  const nodes: OrganizationAgentNode[] = mapData.agents
    .map((agent) => {
      const stats = performance.get(agent.id) ?? { sales: 0, billCount: 0, payout: 0, commission: 0, net: 0 };
      const customers = customerRows.get(agent.id) ?? [];
      const drawQuery = currentDraw ? `?drawId=${currentDraw.id}` : "";
      const csvQuery = currentDraw ? `?draw=${currentDraw.id}` : "";
      return {
        id: agent.id,
        code: agent.code,
        name: agent.name,
        status: agent.status,
        commissionRate: Number(agent.commissionRate),
        customerCount: customerCounts.get(agent.id) ?? 0,
        sales: stats.sales,
        billCount: stats.billCount,
        payout: stats.payout,
        commission: stats.commission,
        net: stats.net,
        profileHref: `/agents/${agent.id}${drawQuery}`,
        csvHref: `/api/agents/${agent.id}/customers${csvQuery}`,
        customers: customers.map((customer) => ({
          key: customer.key,
          name: customer.name,
          billCount: customer.billCount,
          gross: customer.gross,
          profileHref: `/customers/${customerProfileKey(customer.name)}`,
        })),
      } satisfies OrganizationAgentNode;
    })
    .sort((a, b) => b.sales - a.sales || a.code.localeCompare(b.code, "th-TH"));

  const totalSales = nodes.reduce((sum, agent) => sum + agent.sales, 0);
  const totalCustomers = nodes.reduce((sum, agent) => sum + agent.customerCount, 0);
  const activeAgents = nodes.filter((agent) => agent.status === "ACTIVE").length;
  const selectedDrawLabel = currentDraw?.name ?? "ทุกงวด";

  return <main className="agents-page agents-map-page">
    <header className="agents-map-header">
      <div className="agents-map-title"><span><DashboardIcon name="agent" /></span><div><p>ORGANIZATION & CUSTOMER MAP</p><h1>โครงสร้าง Agent และลูกค้า</h1><small>ดูความสัมพันธ์ เจ้าของ → Agent → ลูกค้า พร้อมยอดขายจริงในแต่ละระดับ</small></div></div>
      <section className="agents-map-kpis" aria-label="สรุปโครงสร้าง Agent">
        <article><span><DashboardIcon name="agent" /></span><small>Agent</small><strong>{nodes.length}</strong></article>
        <article><i /><small>ใช้งาน</small><strong>{activeAgents}</strong></article>
        <article><span><DashboardIcon name="winner" /></span><small>ลูกค้า</small><strong>{totalCustomers}</strong></article>
        <article><span><DashboardIcon name="wallet" /></span><small>ยอดขาย</small><strong>{MONEY.format(totalSales)} ฿</strong></article>
      </section>
    </header>

    <OrganizationMap
      ownerName={actor.displayName}
      organizationName={organization?.name ?? "ภาพรวมองค์กร"}
      draws={drawOptions.map((draw) => ({ id: draw.id, name: draw.name }))}
      selectedDrawId={currentDraw?.id ?? ""}
      selectedDrawLabel={selectedDrawLabel}
      csvHref={`/api/agents/customers${currentDraw ? `?draw=${currentDraw.id}` : ""}`}
      agents={nodes}
    />
  </main>;
}

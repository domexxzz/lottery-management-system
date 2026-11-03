import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listAgents } from "@/lib/agents/service";
import { CreateAgentForm, StatusForm } from "./AgentForms";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "ใช้งาน",
  SUSPENDED: "ระงับ",
  CLOSED: "ปิด",
};

export default async function AgentsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "agent.manage")) redirect("/");

  const agents = await listAgents(actor);

  return (
    <main>
      <section className="card" aria-labelledby="agents-heading">
        <p>
          <Link href="/">← หน้าแรก</Link>
        </p>
        <h1 id="agents-heading">จัดการ Agent</h1>

        <table>
          <thead>
            <tr>
              <th scope="col">รหัส</th>
              <th scope="col">ชื่อ</th>
              <th scope="col">บัญชีผู้ใช้</th>
              <th scope="col">คอม (%)</th>
              <th scope="col">วงเงินต่อรอบ</th>
              <th scope="col">วงเงินต่อเลข</th>
              <th scope="col">บิล</th>
              <th scope="col">สถานะ</th>
              <th scope="col">การจัดการ</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id}>
                <td>{agent.code}</td>
                <td>{agent.name}</td>
                <td>{agent.user?.login ?? <span className="muted">ยังไม่ผูก</span>}</td>
                <td>{agent.commissionRate.toFixed(2)}</td>
                <td>
                  {agent.creditLimit === null ? (
                    <span className="muted">ไม่จำกัด</span>
                  ) : (
                    agent.creditLimit.toFixed(2)
                  )}
                </td>
                <td>
                  {agent.perNumberLimit === null ? (
                    <span className="muted">ไม่จำกัด</span>
                  ) : (
                    agent.perNumberLimit.toFixed(2)
                  )}
                </td>
                <td>{agent._count.bills}</td>
                <td>{STATUS_LABEL[agent.status] ?? agent.status}</td>
                <td>
                  <StatusForm agentId={agent.id} currentStatus={agent.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>เพิ่ม Agent ใหม่</h2>
        <p className="muted">
          Agent ที่สร้างใหม่จะยังไม่มีบัญชีผู้ใช้ ต้องผูกบัญชีให้ก่อนจึงจะ login สร้างบิลได้
        </p>
        <CreateAgentForm />
      </section>
    </main>
  );
}

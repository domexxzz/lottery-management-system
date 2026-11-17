import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { loadOwnerReport } from "@/lib/reports/owner-report";
import { AgentReports } from "./AgentReports";
import { OwnerReport } from "./OwnerReport";

export const dynamic = "force-dynamic";

/**
 * หน้ารายงาน
 *
 * - Agent: รายงานของตนเอง (AgentReports)
 * - Owner/Admin: ตอบ 3 คำถาม ได้หรือเสีย / ต้องทำอะไร / เงินมาจากไหน ทีละงวด
 *   เครื่องมือสร้างกราฟเองย้ายไปที่ /reports/charts เพื่อให้หน้านี้เบาและเปิดเร็ว
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ draw?: string; lottery?: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (actor.role === "AGENT") return <AgentReports actor={actor} />;

  const { draw, lottery } = await searchParams;
  const report = await loadOwnerReport(actor, draw, lottery);
  if (!report) {
    return (
      <main className="workspace-page">
        <section className="card workspace-card">
          <h1>รายงาน</h1>
          <p>ยังไม่มีงวดในระบบ สร้างงวดและรับบิลก่อน แล้วรายงานจะขึ้นที่นี่</p>
          <Link href="/draws">ไปหน้างวด →</Link>
        </section>
      </main>
    );
  }
  return <OwnerReport report={report} />;
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listAgentPromotions } from "@/lib/users/service";
import { PromotionBoard, type PromotionBoardRow } from "./PromotionBoard";
import "../users.css";
import "./promotions.css";

export const dynamic = "force-dynamic";

export default async function PromotionsPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "user.manage")) redirect("/");

  const agents = await listAgentPromotions(actor);
  const rows: PromotionBoardRow[] = agents.map((agent) => ({
    agentId: agent.agentId,
    userId: agent.userId,
    code: agent.code,
    name: agent.name,
    suspended: agent.status === "SUSPENDED",
    commissionRate: agent.commissionRate,
    laoCommissionRate: agent.laoCommissionRate,
    state: agent.promotion.state,
    startsOn: agent.promotion.startsOn,
    endsOn: agent.promotion.endsOn,
    daysLeft: agent.promotion.daysLeft,
    thaiMinGross: agent.promotion.thai?.minGross.toString() ?? null,
    thaiRate: agent.promotion.thai?.rate.toString() ?? null,
    laoMinGross: agent.promotion.lao?.minGross.toString() ?? null,
    laoRate: agent.promotion.lao?.rate.toString() ?? null,
  }));
  const active = rows.filter((row) => row.state === "ACTIVE" || row.state === "ENDING_SOON").length;

  return <main className="users-page promotions-page">
    <header className="users-hero">
      <div>
        <Link href="/users">← กลับหน้าจัดการผู้ใช้งาน</Link>
        <p className="eyebrow">Commission Promotions</p>
        <h1>โปรโมชั่นค่าคอม</h1>
        <p>ดูว่าใครได้โปรโมชั่นอยู่ อันไหนใกล้หมด และตั้งเกณฑ์ชุดเดียวให้หลายคนพร้อมกัน · โปรโมชั่นคิดจากยอดขายของแต่ละงวด ไม่ใช่ยอดสะสม</p>
      </div>
      <div className="users-summary">
        <span>Agent <b>{rows.length}</b></span>
        <span>มีโปรฯ ใช้งานอยู่ <b>{active}</b></span>
        <span>หมด / ใกล้หมด <b>{rows.filter((row) => row.state === "ENDING_SOON" || row.state === "EXPIRED").length}</b></span>
      </div>
    </header>
    <PromotionBoard rows={rows} />
  </main>;
}

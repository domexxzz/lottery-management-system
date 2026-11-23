import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { NotFoundError } from "@/lib/errors";
import { displayLogin } from "@/lib/users/identity";
import { getManagedUser } from "@/lib/users/service";
import { EditUserForm, type EditableUser } from "../../UserForms";
import "../../users.css";

export const dynamic = "force-dynamic";

export default async function EditUserPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "user.manage")) redirect("/");

  const { id } = await params;
  let managedUser;
  try {
    managedUser = await getManagedUser(actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (managedUser.role !== "ADMIN" && managedUser.role !== "AGENT") notFound();

  const user: EditableUser = {
    id: managedUser.id,
    login: displayLogin(managedUser.login),
    displayName: managedUser.displayName,
    role: managedUser.role,
    status: managedUser.status,
    agent: managedUser.agent ? {
      code: managedUser.agent.code,
      name: managedUser.agent.name,
      commissionRate: managedUser.agent.commissionRate.toString(),
      laoCommissionRate: managedUser.agent.laoCommissionRate.toString(),
      commissionPromotionStartsOn: managedUser.agent.commissionPromotionStartsOn?.toISOString().slice(0, 10) ?? "",
      commissionPromotionEndsOn: managedUser.agent.commissionPromotionEndsOn?.toISOString().slice(0, 10) ?? "",
      commissionPromotionMinGross: managedUser.agent.commissionPromotionMinGross?.toString() ?? "",
      commissionPromotionThaiRate: managedUser.agent.commissionPromotionThaiRate?.toString() ?? "",
      commissionPromotionLaoRate: managedUser.agent.commissionPromotionLaoRate?.toString() ?? "",
      creditLimit: managedUser.agent.creditLimit?.toString() ?? "",
      perNumberLimit: managedUser.agent.perNumberLimit?.toString() ?? "",
    } : null,
  };

  return <main className="users-page user-edit-page">
    <header className="users-hero user-edit-hero">
      <div><Link href="/users">← กลับหน้าจัดการผู้ใช้</Link><p className="eyebrow">Edit User Account</p><h1>แก้ไขผู้ใช้งาน</h1><p>แก้ข้อมูลการใช้งานได้ทั้งหมด ยกเว้น Username</p></div>
      <div className="user-edit-identity"><small>บัญชีที่กำลังแก้ไข</small><strong>{user.displayName}</strong><span>@{user.login}</span></div>
    </header>
    <article className="users-card user-edit-card"><EditUserForm user={user} /></article>
  </main>;
}

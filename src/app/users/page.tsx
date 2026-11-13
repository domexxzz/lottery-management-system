import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listManagedUsers, nextAgentIdentity } from "@/lib/users/service";
import { displayLogin } from "@/lib/users/identity";
import { AccountGuide, CreateUserForm, UserDeleteForm, UserPasswordForm, UserStatusForm } from "./UserForms";
import "./users.css";

const roleLabel = (role: string) => role === "OWNER" ? "Owner" : role === "ADMIN" ? "Admin" : "Agent";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "user.manage")) redirect("/");
  const [users, nextAgent] = await Promise.all([listManagedUsers(actor), nextAgentIdentity(actor.organizationId)]);
  const active = users.filter((user) => user.status === "ACTIVE").length;
  return <main className="users-page">
    <header className="users-hero"><div><Link href="/">← กลับหน้าภาพรวม</Link><p className="eyebrow">Access & Role Management</p><h1>จัดการผู้ใช้งาน</h1><p>Owner สร้างบัญชี Admin และ Agent พร้อมควบคุมสถานะได้จากหน้านี้</p></div><div className="users-summary"><span>ทั้งหมด <b>{users.length}</b></span><span>ใช้งาน <b>{active}</b></span><span>ระงับ <b>{users.length - active}</b></span></div></header>
    <section className="users-layout">
      <article className="users-card user-list-card"><header><div><p className="eyebrow">User Accounts</p><h2>บัญชี Admin และ Agent</h2></div></header>{users.length === 0 ? <p className="empty-state">ยังไม่มีบัญชีที่จัดการได้</p> : <div className="users-table-wrap"><table><thead><tr><th>ผู้ใช้งาน</th><th>บทบาท</th><th>Agent</th><th>เข้าสู่ระบบล่าสุด</th><th>สถานะ</th><th>การจัดการ</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><small>@{displayLogin(user.login)}{user.mustChangePassword ? " · รอเปลี่ยนรหัสผ่าน" : ""}</small></td><td><span className={`role-chip role-${user.role.toLowerCase()}`}>{roleLabel(user.role)}</span></td><td>{user.agent ? `${user.agent.code} · ${user.agent.name}` : "—"}</td><td>{user.lastLoginAt ? user.lastLoginAt.toLocaleString("th-TH", { timeZone: "Asia/Bangkok" }) : "ยังไม่เคย"}</td><td><span className={`status-chip status-${user.status.toLowerCase()}`}>{user.status === "ACTIVE" ? "ใช้งาน" : "ระงับ"}</span></td><td>{user.id === actor.userId ? <small>บัญชีที่กำลังใช้งาน</small> : <div className="user-row-actions"><UserStatusForm userId={user.id} currentStatus={user.status} /><UserPasswordForm userId={user.id} name={user.displayName} /><UserDeleteForm userId={user.id} name={user.displayName} /></div>}</td></tr>)}</tbody></table></div>}</article>
      <article className="users-card user-create-card"><header><div><p className="eyebrow">Create Account</p><h2>สร้างบัญชีใหม่</h2></div></header><AccountGuide /><CreateUserForm nextAgentLogin={displayLogin(nextAgent.login)} /></article>
    </section>
  </main>;
}

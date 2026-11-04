import type { Role } from "@prisma/client";
import { SidebarNav } from "./SidebarNav";
import { logoutAction } from "./logout-action";

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "เจ้าของกิจการ",
  ADMIN: "ผู้ดูแลระบบ",
  CHECKER: "ผู้ตรวจสอบ",
  AGENT: "ตัวแทน",
};

export function AppShell({
  children,
  displayName,
  role,
}: {
  children: React.ReactNode;
  displayName: string;
  role: Role;
}) {
  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-mark">
          <span>ล</span>
          <div><strong>ระบบจัดการหวย</strong><small>{ROLE_LABEL[role]}</small></div>
        </div>
        <SidebarNav role={role} />
        <div className="sidebar-user">
          <span className="user-avatar">{displayName.slice(0, 1)}</span>
          <div><strong>{displayName}</strong><small>{ROLE_LABEL[role]}</small></div>
        </div>
      </aside>

      <section className="dashboard-content">
        <header className="dashboard-topbar">
          <div className="system-state"><span className="online-dot" /> ระบบพร้อมใช้งาน</div>
          <div className="topbar-account"><span className="topbar-avatar">{displayName.slice(0, 1)}</span><span><strong>{displayName}</strong><small>{ROLE_LABEL[role]}</small></span><form action={logoutAction}><button className="logout-button" type="submit">ออกจากระบบ</button></form></div>
        </header>
        <div className="app-page">{children}</div>
      </section>
    </div>
  );
}

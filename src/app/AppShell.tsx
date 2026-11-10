import type { Role } from "@prisma/client";
import { SidebarNav } from "./SidebarNav";
import { logoutAction } from "./logout-action";
import { DashboardIcon } from "./DashboardIcon";
import { AccountMenu, MobileNavigation, SystemStatus } from "./ShellControls";
import "./owner-chatbot.css";

const ROLE_LABEL: Record<Role, string> = {
  GODMODE: "ผู้ดูแลระบบสูงสุด",
  OWNER: "เจ้าของกิจการ",
  ADMIN: "ผู้ดูแลระบบ",
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
      <a className="skip-link" href="#main-content">ข้ามไปยังเนื้อหาหลัก</a>
      <aside className="dashboard-sidebar">
        <div className="brand-mark">
          <span><DashboardIcon name="brand" /></span>
          <div><strong>ระบบจัดการหวย</strong><small>{ROLE_LABEL[role]}</small></div>
        </div>
        <SidebarNav role={role} />
        <div className="sidebar-user">
          <span className="user-avatar">{displayName.slice(0, 1)}</span>
          <div><strong>{displayName}</strong><small>{ROLE_LABEL[role]}</small></div>
        </div>
        <form className="sidebar-logout" action={logoutAction}>
          <button type="submit">ออกจากระบบ</button>
        </form>
      </aside>

      <section className="dashboard-content">
        <header className="dashboard-topbar">
          <div className="topbar-start">
            <MobileNavigation role={role} />
            <SystemStatus />
          </div>
          <div className="topbar-end">
            <AccountMenu displayName={displayName} roleLabel={ROLE_LABEL[role]} />
          </div>
        </header>
        <div className="app-page" id="main-content" tabIndex={-1}>{children}</div>
      </section>
    </div>
  );
}

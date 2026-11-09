"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Role } from "@prisma/client";
import { DashboardIcon } from "./DashboardIcon";
import { SidebarNav } from "./SidebarNav";
import { logoutAction } from "./logout-action";

export function MobileNavigation({ role }: { role: Role }) {
  const pathname = usePathname();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  const bottomItems = [
    { href: "/", label: "ภาพรวม", icon: "home" as const, active: pathname === "/" },
    { href: "/bills", label: "บิล", icon: "bill" as const, active: pathname.startsWith("/bills") },
    { href: "/reports", label: "วิเคราะห์", icon: "analytics" as const, active: pathname.startsWith("/reports") || pathname.startsWith("/analytics") },
  ];

  function openNavigation() {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
  }

  function closeNavigation() {
    const element = dialog.current;
    if (!element) return;
    if (typeof element.close === "function") element.close();
    else {
      element.removeAttribute("open");
      trigger.current?.focus();
    }
  }

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    function closeOnDesktop() {
      if (desktop.matches) closeNavigation();
    }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className="mobile-navigation">
      <button ref={trigger} type="button" className="shell-icon-button" aria-label="เปิดเมนูหลัก"
        aria-haspopup="dialog" onClick={openNavigation}>
        <DashboardIcon name="menu" />
      </button>
      <nav className="mobile-bottom-nav" aria-label="เมนูด่วนสำหรับมือถือ">
        {bottomItems.map((item) => <Link key={item.href} href={item.href} className={item.active ? "active" : undefined} aria-current={item.active ? "page" : undefined}>
          <DashboardIcon name={item.icon} /><span>{item.label}</span>
        </Link>)}
        <button type="button" className={bottomItems.some((item) => item.active) ? undefined : "active"} aria-label="เปิดเมนูเพิ่มเติม" aria-haspopup="dialog" onClick={openNavigation}>
          <DashboardIcon name="menu" /><span>เพิ่มเติม</span>
        </button>
      </nav>
      <dialog ref={dialog} className="mobile-drawer" aria-labelledby="mobile-nav-title"
        onClose={() => trigger.current?.focus()}>
        <div className="mobile-drawer-header">
          <strong id="mobile-nav-title">เมนูหลัก</strong>
          <button type="button" className="shell-icon-button" aria-label="ปิดเมนู"
            onClick={closeNavigation}>
            <DashboardIcon name="close" />
          </button>
        </div>
        <SidebarNav role={role} onNavigate={closeNavigation} />
      </dialog>
    </div>
  );
}

const STATUS_LABELS = {
  checking: "กำลังตรวจสถานะ",
  ready: "ระบบพร้อมใช้งาน",
  unavailable: "ตรวจสอบสถานะไม่ได้",
  degraded: "ระบบขัดข้องบางส่วน",
};

export function SystemStatus() {
  const [status, setStatus] = useState<keyof typeof STATUS_LABELS>("checking");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);
    let mounted = true;

    async function check() {
      try {
        const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
        const result = await response.json();
        if (!mounted) return;
        if (response.ok && result.status === "ok") setStatus("ready");
        else setStatus(result.status === "degraded" ? "degraded" : "unavailable");
      } catch {
        if (mounted) setStatus("unavailable");
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void check();
    return () => {
      mounted = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return <span className="system-state" data-status={status} role="status">
    <span className="online-dot" aria-hidden="true" /><span className="system-state-label">{STATUS_LABELS[status]}</span>
  </span>;
}

export function AccountMenu({ displayName, roleLabel }: { displayName: string; roleLabel: string }) {
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (menu.current?.open && !event.composedPath().includes(menu.current)) menu.current.open = false;
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  return (
    <details ref={menu} className="account-menu" onKeyDown={(event) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    }}>
      <summary aria-label={`บัญชีของ ${displayName}`}>
        <span className="topbar-avatar" aria-hidden="true">{displayName.slice(0, 1)}</span>
        <strong>{displayName}</strong>
        <DashboardIcon name="chevron" />
      </summary>
      <div className="account-popover">
        <strong>{displayName}</strong>
        <small>{roleLabel}</small>
        <form action={logoutAction}>
          <button className="logout-button" type="submit">ออกจากระบบ</button>
        </form>
      </div>
    </details>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Role } from "@prisma/client";
import { DashboardIcon } from "./DashboardIcon";
import { SidebarNav } from "./SidebarNav";
import { logoutAction } from "./logout-action";

type Theme = "light" | "dark";

function resolvedTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const saved = window.localStorage.getItem("lottery-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const next = resolvedTheme();
      document.documentElement.dataset.theme = next;
      setTheme(next);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    window.localStorage.setItem("lottery-theme", next);
    document.documentElement.dataset.theme = next;
    setTheme(next);
  }

  return <button type="button" className="theme-toggle shell-icon-button" onClick={toggleTheme}
    aria-label={theme === "dark" ? "เปลี่ยนเป็นธีมสว่าง" : "เปลี่ยนเป็นธีมมืด"}
    title={theme === "dark" ? "ธีมสว่าง" : "ธีมมืด"}>
    <span aria-hidden="true">{theme === "dark" ? "☀" : "☾"}</span>
  </button>;
}

export function MobileNavigation({ role }: { role: Role }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    function closeOnDesktop() {
      if (desktop.matches) dialog.current?.close();
    }
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <div className="mobile-navigation">
      <button ref={trigger} type="button" className="shell-icon-button" aria-label="เปิดเมนูหลัก"
        aria-haspopup="dialog" onClick={() => dialog.current?.showModal()}>
        <DashboardIcon name="menu" />
      </button>
      <dialog ref={dialog} className="mobile-drawer" aria-labelledby="mobile-nav-title"
        onClose={() => trigger.current?.focus()}>
        <div className="mobile-drawer-header">
          <strong id="mobile-nav-title">เมนูหลัก</strong>
          <button type="button" className="shell-icon-button" aria-label="ปิดเมนู"
            onClick={() => dialog.current?.close()}>
            <DashboardIcon name="close" />
          </button>
        </div>
        <SidebarNav role={role} onNavigate={() => dialog.current?.close()} />
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

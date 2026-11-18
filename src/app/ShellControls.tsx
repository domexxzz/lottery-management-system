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

  const bottomItems = role === "AGENT"
    ? [
        { href: "/bills", label: "รายการบิล", icon: "bill" as const, active: pathname.startsWith("/bills") },
        { href: "/draws", label: "งวด", icon: "draw" as const, active: pathname.startsWith("/draws") },
        { href: "/reports", label: "รายงาน", icon: "report" as const, active: pathname.startsWith("/reports") },
      ]
    : [
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
  offline: "ไม่มีอินเทอร์เน็ต",
};

/** เวลารอแต่ละครั้ง: dev server คอมไพล์ route ครั้งแรกหรือ DB เพิ่งตื่นอาจเกิน 5 วินาที */
const HEALTH_TIMEOUT_MS = 10_000;
/** ลองซ้ำก่อนสรุปว่าตรวจไม่ได้ เน็ตมือถือสะดุดครั้งเดียวไม่ควรขึ้นว่าระบบขัดข้อง */
const HEALTH_RETRY_DELAYS_MS = [2_000, 5_000];
/** ตรวจซ้ำเป็นระยะระหว่างเปิดหน้าไว้ */
const HEALTH_INTERVAL_MS = 60_000;

type HealthStatus = keyof typeof STATUS_LABELS;

async function probeHealth(signal: AbortSignal): Promise<HealthStatus> {
  // ไม่ใช้ AbortSignal.any/timeout เพราะ Safari บน iPhone รุ่นเก่ายังไม่มี
  const local = new AbortController();
  const timer = window.setTimeout(() => local.abort(), HEALTH_TIMEOUT_MS);
  const forward = () => local.abort();
  signal.addEventListener("abort", forward, { once: true });
  let response: Response;
  let result: { status?: string } | null;
  try {
    response = await fetch("/api/health", { cache: "no-store", signal: local.signal });
    result = await response.json().catch(() => null) as { status?: string } | null;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", forward);
  }
  if (response.ok && result?.status === "ok") return "ready";
  // 503 + degraded = เว็บตอบได้แต่ฐานข้อมูลล่ม ต่างจากติดต่อเว็บไม่ได้เลย
  if (result?.status === "degraded") return "degraded";
  throw new Error(`health ${response.status}`);
}

export function SystemStatus() {
  const [status, setStatus] = useState<HealthStatus>("checking");

  useEffect(() => {
    const controller = new AbortController();
    let running = false;
    const wait = (ms: number) => new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, ms);
      controller.signal.addEventListener("abort", () => { window.clearTimeout(timer); resolve(); }, { once: true });
    });

    async function check() {
      if (running || controller.signal.aborted) return;
      running = true;
      try {
        for (let attempt = 0; attempt <= HEALTH_RETRY_DELAYS_MS.length; attempt += 1) {
          if (!navigator.onLine) {
            setStatus("offline");
            return;
          }
          try {
            const result = await probeHealth(controller.signal);
            if (!controller.signal.aborted) setStatus(result);
            return;
          } catch {
            if (controller.signal.aborted) return;
            const delay = HEALTH_RETRY_DELAYS_MS[attempt];
            if (delay === undefined) break;
            await wait(delay);
          }
        }
        if (!controller.signal.aborted) setStatus(navigator.onLine ? "unavailable" : "offline");
      } finally {
        running = false;
      }
    }

    const recheck = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    const interval = window.setInterval(recheck, HEALTH_INTERVAL_MS);
    window.addEventListener("online", recheck);
    window.addEventListener("offline", () => setStatus("offline"), { signal: controller.signal });
    document.addEventListener("visibilitychange", recheck);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", recheck);
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

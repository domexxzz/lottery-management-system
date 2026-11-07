"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../AppDropdown";

type AgentOption = { id: string; code: string; name: string };

export function AgentDashboardFilters({
  draws,
  agents,
}: {
  draws: { id: string; name: string }[];
  agents: AgentOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (value) params.set(key, value); else params.delete(key);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <section className={`agent-filters ${pending ? "is-loading" : ""}`} aria-label="ตัวกรองผลงาน Agent">
    <div className="agent-filter-fields">
      <label>ค้นหา Agent<AppDropdown value={searchParams.get("agentId") ?? ""} onValueChange={(value) => update("agentId", value)} options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: `${agent.code} · ${agent.name}` }))]} searchable searchPlaceholder="พิมพ์ชื่อหรือรหัส Agent" /></label>
      <label>รอบ<AppDropdown value={searchParams.get("drawId") === "all" ? "" : searchParams.get("drawId") ?? ""} onValueChange={(value) => update("drawId", value)} options={[{ value: "", label: "ทุกรอบ" }, ...draws.map((draw) => ({ value: draw.id, label: draw.name }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหารอบ" /></label>
      <label>สถานะ<AppDropdown value={searchParams.get("status") ?? ""} onValueChange={(value) => update("status", value)} options={[{ value: "", label: "ทุกสถานะ" }, { value: "ACTIVE", label: "ใช้งาน" }, { value: "SUSPENDED", label: "ระงับ" }, { value: "CLOSED", label: "ปิด" }]} /></label>
      <button type="button" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>ล้างตัวกรอง</button>
    </div>
    {pending && <small className="agent-filter-loading">กำลังอัปเดต…</small>}
  </section>;
}

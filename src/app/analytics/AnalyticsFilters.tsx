"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../AppDropdown";

type Option = { id: string; label: string };

export function AnalyticsFilters({ draws, agents }: { draws: Option[]; agents: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("dateFrom");
    params.delete("dateTo");
    if (value) params.set(key, value); else params.delete(key);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return (
    <section className={`analytics-filters ${pending ? "is-loading" : ""}`} aria-label="ตัวกรองวิเคราะห์เชิงลึก">
      <label>รอบ<AppDropdown value={searchParams.get("drawId") ?? ""} onValueChange={(value) => update("drawId", value)} options={[{ value: "", label: "ทุกรอบ" }, ...draws.map((draw) => ({ value: draw.id, label: draw.label }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหารอบ" /></label>
      <label>Agent<AppDropdown value={searchParams.get("agentId") ?? ""} onValueChange={(value) => update("agentId", value)} options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.label }))]} searchable={agents.length > 6} searchPlaceholder="ค้นหา Agent" /></label>
      <label>สถานะบิล<AppDropdown value={searchParams.get("status") ?? ""} onValueChange={(value) => update("status", value)} options={[{ value: "", label: "ทุกสถานะ" }, { value: "CONFIRMED", label: "ยืนยันแล้ว" }, { value: "LOCKED", label: "ล็อกแล้ว" }, { value: "SETTLED", label: "คำนวณแล้ว" }]} /></label>
      <button type="button" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>ล้างตัวกรอง</button>
      {pending && <small>กำลังอัปเดตข้อมูล…</small>}
    </section>
  );
}

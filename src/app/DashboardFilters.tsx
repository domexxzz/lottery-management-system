"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

type Option = { id: string; label: string };

export function DashboardFilters({ draws, agents }: { draws: Option[]; agents: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <section className={`dashboard-filters ${pending ? "is-loading" : ""}`} aria-label="ตัวกรองภาพรวม">
    <div className="filter-heading"><div><p className="eyebrow">ตัวกรองข้อมูล</p><h2>ดูข้อมูลแบบละเอียด</h2></div><button type="button" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>ล้างตัวกรอง</button></div>
    <div className="filter-fields">
      <label>รอบ<select value={searchParams.get("drawId") ?? ""} onChange={(event) => update("drawId", event.target.value)}><option value="">ทุกรอบ</option>{draws.map((draw) => <option key={draw.id} value={draw.id}>{draw.label}</option>)}</select></label>
      <label>Agent<select value={searchParams.get("agentId") ?? ""} onChange={(event) => update("agentId", event.target.value)}><option value="">ทุก Agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label>
      <label>สถานะบิล<select value={searchParams.get("status") ?? ""} onChange={(event) => update("status", event.target.value)}><option value="">ทุกสถานะ</option><option value="DRAFT">แบบร่าง</option><option value="CONFIRMED">ยืนยันแล้ว</option><option value="LOCKED">ล็อกแล้ว</option><option value="SETTLED">คำนวณแล้ว</option><option value="CANCELLED">ยกเลิกแล้ว</option></select></label>
      <label>ตั้งแต่<input type="date" value={searchParams.get("dateFrom") ?? ""} onChange={(event) => update("dateFrom", event.target.value)}/></label>
      <label>ถึงวันที่<input type="date" value={searchParams.get("dateTo") ?? ""} onChange={(event) => update("dateTo", event.target.value)}/></label>
    </div>
    {pending && <span className="filter-loading">กำลังอัปเดตข้อมูล…</span>}
  </section>;
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../AppDropdown";

type DrawOption = { id: string; name: string };

export function AgentReportControls({ draws, agentLabel }: { draws: DrawOption[]; agentLabel: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  function clearFilters() {
    const params = new URLSearchParams();
    const view = searchParams.get("view");
    if (view) params.set("view", view);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <section className={`agent-report-controls ${pending ? "is-loading" : ""}`} aria-label="ตัวกรองรายงาน">
    <div className="agent-report-filter-grid">
      <label>รอบ<AppDropdown value={searchParams.get("draw") ?? ""} onValueChange={(value) => update("draw", value)} options={[{ value: "", label: "ทุกรอบ" }, ...draws.map((draw) => ({ value: draw.id, label: draw.name }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหารอบ" /></label>
      <label>ตั้งแต่วันที่<input type="date" value={searchParams.get("dateFrom") ?? ""} onChange={(event) => update("dateFrom", event.target.value)} /></label>
      <label>ถึงวันที่<input type="date" value={searchParams.get("dateTo") ?? ""} onChange={(event) => update("dateTo", event.target.value)} /></label>
      <label>สถานะ Settlement<AppDropdown value={searchParams.get("settlement") ?? ""} onValueChange={(value) => update("settlement", value)} options={[{ value: "", label: "ทุกสถานะ" }, { value: "PENDING", label: "รอ Settlement" }, { value: "DRAFT", label: "คำนวณแล้ว" }, { value: "RECONCILED", label: "ตรวจสอบยอดแล้ว" }, { value: "APPROVED", label: "อนุมัติแล้ว" }]} /></label>
      <button type="button" className="agent-report-clear" onClick={clearFilters}>ล้างตัวกรอง</button>
    </div>
    <div className="agent-report-scope"><span>ข้อมูลเฉพาะ {agentLabel}</span>{pending && <b>กำลังอัปเดตรายงาน…</b>}</div>
  </section>;
}

export function AgentReportActions() {
  const searchParams = useSearchParams();
  const csvHref = `/api/reports/agent${searchParams.size ? `?${searchParams}` : ""}`;
  return <div className="agent-report-actions"><a href={csvHref}>↓ ดาวน์โหลด CSV</a><button type="button" onClick={() => window.print()}>▣ พิมพ์รายงาน</button></div>;
}

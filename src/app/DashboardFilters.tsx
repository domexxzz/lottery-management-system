"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "./AppDropdown";
import { DashboardIcon as Icon } from "./DashboardIcon";

type Option = { id: string; label: string };

export function DashboardFilters({ draws }: { draws: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <section className="dashboard-filters" aria-label="ตัวกรองภาพรวม" aria-busy={pending}>
    <div className="filter-heading">
      <h2><Icon name="filter" /> กำหนดข้อมูล</h2>
      <button className="filter-reset" type="button" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>
        <Icon name="reset" /> ล้างตัวกรอง
      </button>
    </div>
    <div className="filter-fields">
      <label>รอบ<span className="filter-control"><Icon name="calendar" /><AppDropdown value={searchParams.get("drawId") ?? ""} onValueChange={(value) => update("drawId", value)} options={[{ value: "", label: "ทุกรอบ" }, ...draws.map((draw) => ({ value: draw.id, label: draw.label }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหารอบ" ariaLabel="เลือกรอบ" /></span></label>
      <label>สถานะบิล<span className="filter-control"><Icon name="check" /><AppDropdown value={searchParams.get("status") ?? ""} onValueChange={(value) => update("status", value)} options={[{ value: "", label: "ทุกสถานะ" }, { value: "DRAFT", label: "แบบร่าง" }, { value: "CONFIRMED", label: "ยืนยันแล้ว" }, { value: "LOCKED", label: "ล็อกแล้ว" }, { value: "SETTLED", label: "คำนวณแล้ว" }, { value: "CANCELLED", label: "ยกเลิกแล้ว" }]} ariaLabel="เลือกสถานะบิล" /></span></label>
      <label>ตั้งแต่<span className="filter-control"><Icon name="calendar" /><input type="date" value={searchParams.get("dateFrom") ?? ""} onChange={(event) => update("dateFrom", event.target.value)}/></span></label>
      <label>ถึงวันที่<span className="filter-control"><Icon name="calendar" /><input type="date" value={searchParams.get("dateTo") ?? ""} onChange={(event) => update("dateTo", event.target.value)}/></span></label>
    </div>
    {pending && <span className="filter-loading" role="status">กำลังอัปเดตข้อมูล…</span>}
  </section>;
}

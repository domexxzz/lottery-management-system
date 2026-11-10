"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useTransition } from "react";
import { AppDropdown } from "./AppDropdown";
import { DashboardIcon as Icon } from "./DashboardIcon";
import { DateRangePicker, type DateRangeValue } from "@/components/calendar";
import { recentMonths } from "@/lib/draws/range";

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

  function updateRange(value: DateRangeValue) {
    const params = new URLSearchParams(searchParams.toString());
    if (value.startDate) params.set("dateFrom", value.startDate); else params.delete("dateFrom");
    if (value.endDate) params.set("dateTo", value.endDate); else params.delete("dateTo");
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  // เลือกทั้งเดือน = ตั้งช่วงวันที่ตั้งแต่วันที่ 1 ถึงวันสุดท้ายของเดือนนั้น
  const months = useMemo(() => recentMonths(new Date()), []);
  const dateFrom = searchParams.get("dateFrom") ?? "";
  const dateTo = searchParams.get("dateTo") ?? "";
  const selectedMonth = months.find((month) => month.from === dateFrom && month.to === dateTo)?.key ?? "";
  const customRange = !selectedMonth && Boolean(dateFrom || dateTo);

  function selectMonth(key: string) {
    const month = months.find((item) => item.key === key);
    updateRange({ startDate: month?.from ?? "", endDate: month?.to ?? "" });
  }

  return <section className="dashboard-filters" aria-label="ตัวกรองภาพรวม" aria-busy={pending}>
    <div className="filter-heading">
      <h2><Icon name="filter" /> กำหนดข้อมูล</h2>
      <button className="filter-reset" type="button" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>
        <Icon name="reset" /> ล้างตัวกรอง
      </button>
    </div>
    <div className="filter-fields">
      <label>งวด<span className="filter-control"><Icon name="calendar" /><AppDropdown value={searchParams.get("drawId") ?? ""} onValueChange={(value) => update("drawId", value)} options={[{ value: "", label: "ทุกงวด" }, ...draws.map((draw) => ({ value: draw.id, label: draw.label }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" ariaLabel="เลือกงวด" /></span></label>
      <label>เลือกเดือน<span className="filter-control"><Icon name="calendar" /><AppDropdown value={selectedMonth} onValueChange={selectMonth} options={[{ value: "", label: customRange ? "ช่วงที่เลือกเอง" : "ทุกเดือน" }, ...months.map((month) => ({ value: month.key, label: month.name }))]} ariaLabel="เลือกทั้งเดือน" /></span></label>
      <DateRangePicker startDate={dateFrom} endDate={dateTo} onChange={updateRange} />
    </div>
    {pending && <span className="filter-loading" role="status">กำลังอัปเดตข้อมูล…</span>}
  </section>;
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { DateRangePicker, MonthPicker, type DateRangeValue } from "@/components/calendar";

export function CommissionPeriodFilter({ mode, startDate, endDate, month }: { mode: "range" | "month"; startDate: string; endDate: string; month: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [range, setRange] = useState({ startDate, endDate });

  useEffect(() => setRange({ startDate, endDate }), [startDate, endDate]);

  function navigateMonth(nextValue: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("dateFrom");
    params.delete("dateTo");
    params.set("period", "month");
    params.set("date", nextValue);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  function updateRange(value: DateRangeValue) {
    setRange(value);
    const complete = Boolean(value.startDate && value.endDate);
    const cleared = !value.startDate && !value.endDate;
    if (!complete && !cleared) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.delete("date");
    if (complete) {
      params.set("period", "range");
      params.set("dateFrom", value.startDate);
      params.set("dateTo", value.endDate);
    } else {
      params.delete("period");
      params.delete("dateFrom");
      params.delete("dateTo");
    }
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <section className={`commission-period ${pending ? "is-loading" : ""}`} aria-label="เลือกวันที่หรือเดือนจ่ายค่าคอม" aria-busy={pending}>
    <header><strong>เลือกช่วงที่ต้องการดู</strong><span>เลือกวันเริ่มต้นและวันสิ้นสุด หรือใช้เช็กลิสต์จ่ายค่าคอมรายเดือน</span></header>
    <div className={`commission-period-option is-range ${mode === "range" ? "is-active" : ""}`}>
      <span className="commission-period-label">เลือกช่วงวันที่</span>
      <DateRangePicker
        startLabel="วันเริ่มต้น"
        endLabel="วันสิ้นสุด"
        startPlaceholder="เลือกวันเริ่มต้น"
        endPlaceholder="เลือกวันสิ้นสุด"
        startDate={range.startDate}
        endDate={range.endDate}
        onChange={updateRange}
      />
      <small>แสดงยอดและค่าคอมของงวดที่ออกภายในช่วงวันที่เลือก</small>
    </div>
    <div className={`commission-period-option ${mode === "month" ? "is-active" : ""}`}>
      <label htmlFor="commission-month-picker">เลือกเดือน</label>
      <MonthPicker
        id="commission-month-picker"
        value={mode === "month" ? month : ""}
        placeholder="เปิดปฏิทินเลือกเดือน"
        ariaLabel="เลือกเดือนสำหรับจ่ายค่าคอม"
        onChange={(nextValue) => nextValue && navigateMonth(nextValue)}
      />
      <small>แสดงยอดทั้งเดือนและเปิดเช็กลิสต์จ่ายค่าคอม</small>
    </div>
    {pending && <span className="commission-period-loading" role="status">กำลังคำนวณ…</span>}
  </section>;
}

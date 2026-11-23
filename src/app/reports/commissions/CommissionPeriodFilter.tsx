"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { DatePicker, MonthPicker } from "@/components/calendar";

export function CommissionPeriodFilter({ mode, value }: { mode: "day" | "month"; value: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function navigate(nextMode: "day" | "month", nextValue: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("period", nextMode);
    params.set("date", nextValue);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <section className={`commission-period ${pending ? "is-loading" : ""}`} aria-label="เลือกวันที่หรือเดือนจ่ายค่าคอม" aria-busy={pending}>
    <header><strong>เลือกช่วงที่ต้องการดู</strong><span>ดูรายละเอียดรายวัน หรือเช็กลิสต์จ่ายค่าคอมรายเดือน</span></header>
    <div className={`commission-period-option ${mode === "day" ? "is-active" : ""}`}>
      <label htmlFor="commission-day-picker">เลือกวันที่</label>
      <DatePicker
        id="commission-day-picker"
        value={mode === "day" ? value : ""}
        placeholder="เปิดปฏิทินเลือกวันที่"
        ariaLabel="เลือกวันที่สำหรับดูค่าคอม"
        onChange={(nextValue) => nextValue && navigate("day", nextValue)}
      />
      <small>แสดงยอดและค่าคอมเฉพาะงวดที่ออกในวันที่เลือก</small>
    </div>
    <div className={`commission-period-option ${mode === "month" ? "is-active" : ""}`}>
      <label htmlFor="commission-month-picker">เลือกเดือน</label>
      <MonthPicker
        id="commission-month-picker"
        value={mode === "month" ? value : ""}
        placeholder="เปิดปฏิทินเลือกเดือน"
        ariaLabel="เลือกเดือนสำหรับจ่ายค่าคอม"
        onChange={(nextValue) => nextValue && navigate("month", nextValue)}
      />
      <small>แสดงยอดทั้งเดือนและเปิดเช็กลิสต์จ่ายค่าคอม</small>
    </div>
    {pending && <span className="commission-period-loading" role="status">กำลังคำนวณ…</span>}
  </section>;
}

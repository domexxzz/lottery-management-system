"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

const bangkokToday = () => new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Bangkok",
}).format(new Date());

export function CommissionPeriodFilter({ value }: { value: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const today = bangkokToday();

  function navigate(nextValue: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    params.set("period", "month");
    params.set("date", nextValue);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <section className={`commission-period ${pending ? "is-loading" : ""}`} aria-label="เลือกเดือนจ่ายค่าคอม" aria-busy={pending}>
    <label>
      <span>เดือนที่ต้องการจ่ายค่าคอม</span>
      <input
        type="month"
        value={value || today.slice(0, 7)}
        onChange={(event) => event.currentTarget.value && navigate(event.currentTarget.value)}
      />
    </label>
    {pending && <span className="commission-period-loading" role="status">กำลังคำนวณ…</span>}
  </section>;
}

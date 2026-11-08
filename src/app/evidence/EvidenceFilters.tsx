"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AppDropdown } from "../AppDropdown";
import { DateRangePicker, type DateRangeValue } from "@/components/calendar";

export function EvidenceFilters({ mode = "queue" }: { mode?: "queue" | "verified" }) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get("q") ?? "");

  function update(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    startTransition(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  }

  function updateRange(value: DateRangeValue) {
    const next = new URLSearchParams(params.toString());
    if (value.startDate) next.set("from", value.startDate); else next.delete("from");
    if (value.endDate) next.set("to", value.endDate); else next.delete("to");
    next.delete("page");
    startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false }));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (query.trim() !== (params.get("q") ?? "")) update("q", query.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, params]);

  return <section className={`evidence-filters ${pending ? "is-loading" : ""}`} aria-label="ตัวกรองหลักฐาน">
    <label>ค้นหา<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="เลขบิล ชื่อลูกค้า หรือ Agent" /></label>
    {mode === "queue" && <label>สถานะ<AppDropdown value={params.get("status") ?? ""} onValueChange={(value) => update("status", value)} options={[{ value: "", label: "รอตรวจและตีกลับ" }, { value: "PENDING", label: "รอตรวจสอบ" }, { value: "REJECTED", label: "ถูกตีกลับ" }]} /></label>}
    <label>ประเภท<AppDropdown value={params.get("type") ?? ""} onValueChange={(value) => update("type", value)} options={[{ value: "", label: "ทุกประเภท" }, { value: "ORDER_EVIDENCE", label: "หลักฐานการสั่งซื้อ" }, { value: "PAYMENT_EVIDENCE", label: "หลักฐานการชำระเงิน" }, { value: "OTHER", label: "หลักฐานอื่น" }]} /></label>
    <DateRangePicker startDate={params.get("from") ?? ""} endDate={params.get("to") ?? ""} onChange={updateRange} />
    <button type="button" className="secondary-button" onClick={() => { setQuery(""); startTransition(() => router.replace(pathname, { scroll: false })); }}>ล้างตัวกรอง</button>
    {pending && <small>กำลังอัปเดต…</small>}
  </section>;
}

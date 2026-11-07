"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../../AppDropdown";

type DrawOption = { id: string; name: string; status: string };

const STATUS_LABEL: Record<string, string> = {
  OPEN: "เปิดรับ",
  LOCKED: "ปิดรับแล้ว",
  RESULT_PENDING: "รอผล",
  SETTLED: "คำนวณแล้ว",
  RECONCILED: "ตรวจสอบยอดแล้ว",
  CLOSED: "ปิดบัญชี",
};

export function AllDrawFilters({ draws }: { draws: DrawOption[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value); else params.delete(key);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <section className={`all-draw-filters ${pending ? "is-loading" : ""}`} aria-label="ค้นหาและกรองรอบ">
    <div className="all-draw-search-field"><span>ค้นหารอบ</span><AppDropdown value={searchParams.get("q") ?? ""} onValueChange={(value) => update("q", value)} placeholder="ทุกรอบ" searchPlaceholder="พิมพ์ชื่อรอบ" emptyMessage="ไม่พบรอบที่ค้นหา" searchable options={[{ value: "", label: "ทุกรอบ", description: "แสดงรอบทั้งหมด" }, ...draws.map((draw) => ({ value: draw.name, label: draw.name, description: STATUS_LABEL[draw.status] ?? draw.status, badge: "เลือก" }))]} /></div>
    <label>สถานะ<AppDropdown value={searchParams.get("status") ?? ""} onValueChange={(value) => update("status", value)} options={[{ value: "", label: "ทุกสถานะ" }, { value: "OPEN", label: "เปิดรับ" }, { value: "LOCKED", label: "ปิดรับแล้ว" }, { value: "RESULT_PENDING", label: "รอผล" }, { value: "SETTLED", label: "คำนวณแล้ว" }, { value: "RECONCILED", label: "ตรวจสอบยอดแล้ว" }, { value: "CLOSED", label: "ปิดบัญชี" }]} /></label>
    <span className="all-draw-sort">เปิดรับใหม่สุด → เก่าสุด</span>
    <button type="button" className="all-draw-clear" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>ล้างตัวกรอง</button>
    {pending && <small role="status">กำลังค้นหา…</small>}
  </section>;
}

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../../AppDropdown";

type DrawOption = { id: string; name: string; status: string };

const STATUS_LABEL: Record<string, string> = {
  OPEN: "เปิดรับ",
  CLOSED: "ปิดรับ",
  CHECKED: "ตรวจผลแล้ว",
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

  return <section className={`all-draw-filters ${pending ? "is-loading" : ""}`} aria-label="ค้นหาและกรองงวด">
    <div className="all-draw-search-field"><span>ค้นหางวด</span><AppDropdown value={searchParams.get("q") ?? ""} onValueChange={(value) => update("q", value)} placeholder="ทุกงวด" searchPlaceholder="พิมพ์ชื่องวด" emptyMessage="ไม่พบงวดที่ค้นหา" searchable options={[{ value: "", label: "ทุกงวด", description: "แสดงงวดทั้งหมด" }, ...draws.map((draw) => ({ value: draw.name, label: draw.name, description: STATUS_LABEL[draw.status] ?? draw.status, badge: "เลือก" }))]} /></div>
    <label>สถานะ<AppDropdown value={searchParams.get("status") ?? ""} onValueChange={(value) => update("status", value)} options={[{ value: "", label: "ทุกสถานะ" }, { value: "OPEN", label: "เปิดรับ" }, { value: "CLOSED", label: "ปิดรับ" }, { value: "CHECKED", label: "ตรวจผลแล้ว" }]} /></label>
    <span className="all-draw-sort">เปิดรับใหม่สุด → เก่าสุด</span>
    <button type="button" className="all-draw-clear" onClick={() => startTransition(() => router.replace(pathname, { scroll: false }))}>ล้างตัวกรอง</button>
    {pending && <small role="status">กำลังค้นหา…</small>}
  </section>;
}

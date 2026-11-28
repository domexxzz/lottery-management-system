"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { DateRangePicker } from "@/components/calendar";
import { AppDropdown } from "../../AppDropdown";
import type { DeletionKind } from "@/lib/audit/deletions";

const KINDS: { value: DeletionKind | "ALL"; label: string; description: string }[] = [
  { value: "ALL", label: "ทั้งหมด", description: "ทั้งการลบงวดและลบบิล" },
  { value: "DRAW", label: "ลบงวด", description: "ลบงวดพร้อมบิลและยอดที่ผูกอยู่ถาวร" },
  { value: "BILL", label: "ลบบิล", description: "ตัดบิลออกจากการคำนวณ" },
];

/** ตัวกรองของหน้าประวัติการลบ เก็บสถานะไว้ใน URL เพื่อให้ส่งลิงก์ให้กันตรวจได้ */
export function DeletionFilters({ kind, from, to }: { kind: DeletionKind | "ALL"; from: string; to: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const go = (next: { kind?: string; from?: string; to?: string }) => {
    const params = new URLSearchParams();
    const resolvedKind = next.kind ?? kind;
    const resolvedFrom = next.from ?? from;
    const resolvedTo = next.to ?? to;
    if (resolvedKind !== "ALL") params.set("kind", resolvedKind);
    if (resolvedFrom) params.set("from", resolvedFrom);
    if (resolvedTo) params.set("to", resolvedTo);
    startTransition(() => router.push(`/audit/deletions${params.size ? `?${params}` : ""}`, { scroll: false }));
  };

  return <section className={`deletion-filters ${pending ? "is-loading" : ""}`} aria-label="ตัวกรองประวัติการลบ" aria-busy={pending}>
    <label>
      <span>ประเภทการลบ</span>
      <AppDropdown
        ariaLabel="เลือกประเภทการลบ"
        value={kind}
        onValueChange={(value) => go({ kind: value })}
        options={KINDS}
      />
    </label>
    <div className="deletion-filter-dates">
      <DateRangePicker
        startLabel="ตั้งแต่วันที่"
        endLabel="ถึงวันที่"
        startPlaceholder="เลือกวันเริ่มต้น"
        endPlaceholder="เลือกวันสิ้นสุด"
        startDate={from}
        endDate={to}
        onChange={({ startDate, endDate }) => {
          // รอจนเลือกครบสองวันค่อยโหลดใหม่ ไม่งั้นรายการกระพริบตอนกดวันแรก
          if (startDate && endDate) go({ from: startDate, to: endDate });
          if (!startDate && !endDate && (from || to)) go({ from: "", to: "" });
        }}
      />
    </div>
    {(kind !== "ALL" || from || to) && (
      <button type="button" className="deletion-filter-clear" onClick={() => go({ kind: "ALL", from: "", to: "" })}>
        ล้างตัวกรอง
      </button>
    )}
    {pending && <span role="status" className="deletion-filter-loading">กำลังโหลด…</span>}
  </section>;
}

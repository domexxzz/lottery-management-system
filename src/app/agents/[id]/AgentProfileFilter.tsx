"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../../AppDropdown";

export function AgentProfileFilter({ draws }: { draws: { id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function selectDraw(drawId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (drawId) params.set("drawId", drawId); else params.delete("drawId");
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  return <label className={`agent-profile-filter ${pending ? "is-loading" : ""}`}>
    <span>เลือกรอบที่ต้องการวิเคราะห์</span>
    <AppDropdown value={searchParams.get("drawId") ?? ""} onValueChange={selectDraw} options={[{ value: "", label: "ข้อมูลทั้งหมด" }, ...draws.map((draw) => ({ value: draw.id, label: draw.name }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหารอบ" />
    <small>{pending ? "กำลังอัปเดตข้อมูล…" : "เลือกแล้วข้อมูลทุกส่วนจะเปลี่ยนทันที"}</small>
  </label>;
}

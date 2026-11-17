"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppDropdown } from "../AppDropdown";

type DrawOption = { id: string; label: string; lotteryType?: string };

export function DrawPicker({
  selectedId,
  draws,
  includeAll = true,
  allInUrl = false,
}: {
  selectedId: string;
  draws: DrawOption[];
  /** แสดงตัวเลือก "ทุกงวด" */
  includeAll?: boolean;
  /** ใส่ draw=all ใน URL แทนการลบพารามิเตอร์ ใช้กับหน้าที่ค่าเริ่มต้นไม่ใช่ "ทุกงวด" */
  allInUrl?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  function selectDraw(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && (value !== "all" || allInUrl)) params.set("draw", value); else params.delete("draw");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }
  return (
    <div className="draw-picker">
      <label htmlFor="draw">
        เลือกงวด
        <AppDropdown id="draw" value={selectedId || "all"} onValueChange={selectDraw} options={[...(includeAll ? [{ value: "all", label: "ทุกงวด" }] : []), ...draws.map((draw) => ({ value: draw.id, label: draw.label, lotteryType: draw.lotteryType }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" />
      </label>
    </div>
  );
}

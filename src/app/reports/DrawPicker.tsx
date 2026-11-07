"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppDropdown } from "../AppDropdown";

type DrawOption = { id: string; label: string };

export function DrawPicker({
  selectedId,
  draws,
}: {
  selectedId: string;
  draws: DrawOption[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  function selectDraw(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "all") params.set("draw", value); else params.delete("draw");
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }
  return (
    <div className="draw-picker">
      <label htmlFor="draw">
        เลือกงวด
        <AppDropdown id="draw" value={selectedId || "all"} onValueChange={selectDraw} options={[{ value: "all", label: "ทุกงวด" }, ...draws.map((draw) => ({ value: draw.id, label: draw.label }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" />
      </label>
    </div>
  );
}

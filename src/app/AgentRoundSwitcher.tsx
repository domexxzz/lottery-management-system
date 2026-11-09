"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { AppDropdown } from "./AppDropdown";
import { DRAW_DISPLAY_STATUS_LABEL, getDrawDisplayStatus } from "@/lib/draws/display-status";

type DrawOption = { id: string; name: string; status: string; cutoffAt: string };
function remaining(cutoffAt: string) {
  const milliseconds = new Date(cutoffAt).getTime() - Date.now();
  if (milliseconds <= 0) return "ปิดรับแล้ว";
  const day = 86_400_000;
  if (milliseconds >= day) return `ปิดรับใน ${Math.ceil(milliseconds / day)} วัน`;
  const totalMinutes = Math.max(1, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `ปิดรับใน ${hours} ชม. ${minutes} นาที`;
}

export function AgentRoundSwitcher({ draws, selectedId }: { draws: DrawOption[]; selectedId: string }) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams(); const [pending, startTransition] = useTransition();
  const selected = useMemo(() => draws.find((draw) => draw.id === selectedId), [draws, selectedId]);
  const [countdown, setCountdown] = useState(selected ? remaining(selected.cutoffAt) : "");
  useEffect(() => { setCountdown(selected ? remaining(selected.cutoffAt) : ""); const timer = window.setInterval(() => setCountdown(selected ? remaining(selected.cutoffAt) : ""), 60_000); return () => window.clearInterval(timer); }, [selected]);
  function change(value: string) { const params = new URLSearchParams(searchParams.toString()); if (value === "all") params.delete("drawId"); else params.set("drawId", value); const query = params.toString(); startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })); }
  const selectedStatus = selected ? getDrawDisplayStatus(selected) : null;
  return <div className={`agent-round-switcher ${pending ? "is-loading" : ""}`}><label htmlFor="agent-dashboard-round">เลือกดูงวด</label><div><AppDropdown id="agent-dashboard-round" value={selected?.id ?? "all"} onValueChange={change} options={[{ value: "all", label: "ทุกงวด", description: "ภาพรวมทั้งหมด" }, ...draws.map((draw) => { const status = getDrawDisplayStatus(draw); return { value: draw.id, label: draw.name, description: DRAW_DISPLAY_STATUS_LABEL[status] }; })]} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" /><span className={`agent-round-status status-${selectedStatus?.toLowerCase() ?? "all"}`}>{selectedStatus ? DRAW_DISPLAY_STATUS_LABEL[selectedStatus] : "ข้อมูลทั้งหมด"}</span>{selectedStatus === "OPEN" && <b>◷ {countdown}</b>}</div></div>;
}

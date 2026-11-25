"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppDropdown } from "../AppDropdown";

export function AgentDrawPicker({ options, value, latestName }: { options: Array<{ id: string; name: string }>; value: string; latestName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(drawId: string) {
    startTransition(() => router.replace(drawId ? `/reports?draw=${encodeURIComponent(drawId)}` : "/reports", { scroll: false }));
  }

  return <section className={`agent-simple-picker ${pending ? "is-loading" : ""}`}>
    <div><span>เลือกงวดที่ต้องการดู</span><strong>รายการและผลรางวัลด้านล่างจะเปลี่ยนตามงวดที่เลือก</strong></div>
    <label><span>งวด</span><AppDropdown value={value} onValueChange={select} searchable={options.length > 8} searchPlaceholder="ค้นหาชื่องวด" options={[{ value: "", label: latestName ? `งวดล่าสุด · ${latestName}` : "งวดล่าสุด" }, ...options.map((draw) => ({ value: draw.id, label: draw.name }))]} /></label>
    {pending && <small>กำลังเปลี่ยนงวด…</small>}
  </section>;
}

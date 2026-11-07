"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AppDropdown } from "../AppDropdown";

type Option = { id: string; label: string };

export function AuditFilters({ draws, agents, users }: { draws: Option[]; agents: Option[]; users: Option[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState(params.get("q") ?? "");
  function update(key: string, value: string) { const next = new URLSearchParams(params.toString()); if (value) next.set(key, value); else next.delete(key); startTransition(() => router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false })); }
  useEffect(() => { const timer = window.setTimeout(() => { if (query !== (params.get("q") ?? "")) update("q", query.trim()); }, 350); return () => window.clearTimeout(timer); }, [query, params]);
  return <section className={`inspection-filters ${pending ? "is-loading" : ""}`} aria-label="ตัวกรองประวัติการตรวจ">
    <label>ค้นหาเลข<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="เลขบิล เลขที่คีย์ หรือชื่อลูกค้า"/></label>
    <label>งวด<AppDropdown value={params.get("draw") ?? ""} onValueChange={(value) => update("draw", value)} options={[{ value: "", label: "ทุกงวด" }, ...draws.map((draw) => ({ value: draw.id, label: draw.label }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" /></label>
    <label>Agent<AppDropdown value={params.get("agent") ?? ""} onValueChange={(value) => update("agent", value)} options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.label }))]} searchable={agents.length > 6} searchPlaceholder="ค้นหา Agent" /></label>
    <label>ผู้กรอก<AppDropdown value={params.get("enteredBy") ?? ""} onValueChange={(value) => update("enteredBy", value)} options={[{ value: "", label: "ทุกคน" }, ...users.map((user) => ({ value: user.id, label: user.label }))]} searchable={users.length > 6} searchPlaceholder="ค้นหาผู้กรอก" /></label>
    <label>ผลการตรวจ<AppDropdown value={params.get("check") ?? ""} onValueChange={(value) => update("check", value)} options={[{ value: "", label: "ทุกสถานะ" }, { value: "PASSED", label: "ตรวจแล้ว/ผ่าน" }, { value: "PENDING", label: "รอตรวจ" }, { value: "REJECTED", label: "ตีกลับ/พบปัญหา" }]} /></label>
    <button type="button" onClick={() => { setQuery(""); startTransition(() => router.replace(pathname, { scroll: false })); }}>ล้างตัวกรอง</button>{pending && <small>กำลังอัปเดต…</small>}
  </section>;
}

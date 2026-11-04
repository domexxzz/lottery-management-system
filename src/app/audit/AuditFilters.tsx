"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

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
    <label>รอบ<select value={params.get("draw") ?? ""} onChange={(event) => update("draw", event.target.value)}><option value="">ทุกรอบ</option>{draws.map((draw) => <option key={draw.id} value={draw.id}>{draw.label}</option>)}</select></label>
    <label>Agent<select value={params.get("agent") ?? ""} onChange={(event) => update("agent", event.target.value)}><option value="">ทุก Agent</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.label}</option>)}</select></label>
    <label>ผู้กรอก<select value={params.get("enteredBy") ?? ""} onChange={(event) => update("enteredBy", event.target.value)}><option value="">ทุกคน</option>{users.map((user) => <option key={user.id} value={user.id}>{user.label}</option>)}</select></label>
    <label>ผลการตรวจ<select value={params.get("check") ?? ""} onChange={(event) => update("check", event.target.value)}><option value="">ทุกสถานะ</option><option value="PASSED">ตรวจแล้ว/ผ่าน</option><option value="PENDING">รอตรวจ</option><option value="REJECTED">ตีกลับ/พบปัญหา</option></select></label>
    <button type="button" onClick={() => { setQuery(""); startTransition(() => router.replace(pathname, { scroll: false })); }}>ล้างตัวกรอง</button>{pending && <small>กำลังอัปเดต…</small>}
  </section>;
}

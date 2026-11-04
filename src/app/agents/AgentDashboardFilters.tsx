"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type AgentOption = { id: string; code: string; name: string };

export function AgentDashboardFilters({ draws, agents }: { draws: { id: string; name: string }[]; agents: AgentOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const selectedAgent = agents.find((agent) => agent.id === searchParams.get("agentId"));
  const [query, setQuery] = useState(selectedAgent ? `${selectedAgent.code} · ${selectedAgent.name}` : searchParams.get("q") ?? "");

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (value) params.set(key, value); else params.delete(key);
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  function updateAgent(value: string) {
    setQuery(value);
    const match = agents.find((agent) => `${agent.code} · ${agent.name}` === value);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (match) { params.set("agentId", match.id); params.delete("q"); }
    else { params.delete("agentId"); if (value.trim()) params.set("q", value.trim()); else params.delete("q"); }
    startTransition(() => router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false }));
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (agents.some((agent) => `${agent.code} · ${agent.name}` === query)) return;
      if (!searchParams.get("agentId") && query !== (searchParams.get("q") ?? "")) update("q", query.trim());
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, searchParams, agents]);

  return <section className={`agent-filters ${pending ? "is-loading" : ""}`} aria-label="ตัวกรองผลงาน Agent">
    <div className="agent-filter-fields">
      <label>Agent<input list="agent-filter-options" value={query} onChange={(event) => updateAgent(event.target.value)} placeholder="พิมพ์หรือเลือก Agent" autoComplete="off"/><datalist id="agent-filter-options">{agents.map((agent) => <option key={agent.id} value={`${agent.code} · ${agent.name}`}/>)}</datalist></label>
      <label>รอบ<select value={searchParams.get("drawId") ?? ""} onChange={(event) => update("drawId", event.target.value)}><option value="">งวดปัจจุบัน</option>{draws.map((draw) => <option key={draw.id} value={draw.id}>{draw.name}</option>)}</select></label>
      <label>สถานะ<select value={searchParams.get("status") ?? ""} onChange={(event) => update("status", event.target.value)}><option value="">ทุกสถานะ</option><option value="ACTIVE">ใช้งาน</option><option value="SUSPENDED">ระงับ</option><option value="CLOSED">ปิด</option></select></label>
      <button type="button" onClick={() => { setQuery(""); startTransition(() => router.replace(pathname, { scroll: false })); }}>ล้างตัวกรอง</button>
    </div>
    {pending && <small className="agent-filter-loading">กำลังอัปเดต…</small>}
  </section>;
}

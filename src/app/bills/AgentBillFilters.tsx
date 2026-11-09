"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DateRangePicker } from "@/components/calendar";

type Option = { value: string; label: string };

/**
 * ตัวกรองประวัติรายการ
 *
 * เก็บค่าไว้ในฟอร์มก่อนแล้วค้นหาครั้งเดียวเมื่อกด "ค้นหา"
 * ไม่ยิง request ใหม่ทุกครั้งที่เปลี่ยนค่า ซึ่งทำให้หน้าโหลดซ้ำหลายรอบ
 */
export function AgentBillFilters({
  query,
  from,
  to,
  drawId,
  agentId,
  tab,
  draws,
  agents,
}: {
  query: string;
  from: string;
  to: string;
  drawId: string;
  agentId: string;
  tab: string;
  draws: Option[];
  /** null เมื่อผู้ใช้เป็น Agent ซึ่งเห็นเฉพาะบิลของตนเอง */
  agents: Option[] | null;
}) {
  const router = useRouter();
  const [range, setRange] = useState({ startDate: from, endDate: to });
  const [draw, setDraw] = useState(drawId);
  const [agent, setAgent] = useState(agentId);
  const hasFilter = Boolean(query || from || to || drawId || agentId);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const params = new URLSearchParams();
    if (tab !== "ALL") params.set("tab", tab);
    const values: Record<string, string> = {
      q: String(data.get("q") ?? "").trim(),
      from: range.startDate,
      to: range.endDate,
      draw,
      agent,
    };
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
    router.push(`/bills${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  return (
    <form
      className={`slip-filter-card ${agents ? "has-agent" : ""}`}
      aria-label="ค้นหาและกรองประวัติรายการ"
      onSubmit={(event) => { event.preventDefault(); submit(event.currentTarget); }}
    >
      <label className="slip-search">
        <span className="sr-only">ค้นหาเลขบิลหรือชื่อลูกค้า</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input name="q" defaultValue={query} placeholder="ค้นหาเลขบิล / ชื่อลูกค้า" />
      </label>
      <div className="slip-filter-dates">
        <DateRangePicker
          startLabel="ตั้งแต่"
          endLabel="ถึงวันที่"
          startPlaceholder="เลือกวันที่"
          endPlaceholder="เลือกวันที่"
          startDate={range.startDate}
          endDate={range.endDate}
          onChange={setRange}
        />
      </div>
      <label className="slip-filter-select slip-filter-draw">
        <span>งวด</span>
        <select value={draw} onChange={(event) => setDraw(event.target.value)}>
          <option value="">ทุกงวด</option>
          {draws.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {agents && (
        <label className="slip-filter-select slip-filter-agent">
          <span>Agent</span>
          <select value={agent} onChange={(event) => setAgent(event.target.value)}>
            <option value="">ทุก Agent</option>
            {agents.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )}
      <div className="slip-filter-actions">
        <button
          type="button"
          className="slip-clear-filter"
          disabled={!hasFilter}
          onClick={() => router.push(tab === "ALL" ? "/bills" : `/bills?tab=${tab}`, { scroll: false })}
        >
          ล้างตัวกรอง
        </button>
        <button type="submit" className="slip-search-button">ค้นหา</button>
      </div>
    </form>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DateRangePicker } from "@/components/calendar";

type Option = { value: string; label: string };

type Values = { q: string; from: string; to: string; draw: string; agent: string };

/** รอให้หยุดพิมพ์ก่อนค่อยค้นหา ไม่ยิง request ทุกตัวอักษร */
const TYPING_DELAY_MS = 400;

/**
 * ตัวกรองประวัติรายการ — เปลี่ยนค่าแล้วค้นหาทันที ไม่ต้องกดปุ่ม
 *
 * - งวด / Agent: ค้นหาทันทีที่เลือก
 * - ช่วงวันที่: ค้นหาเมื่อเลือกครบทั้งสองวัน (หรือล้างทั้งคู่) ไม่โหลดตอนเพิ่งเลือกวันแรก
 * - ช่องค้นหา: ค้นหาเมื่อหยุดพิมพ์ครู่หนึ่ง หรือกด Enter
 */
export function AgentBillFilters({
  query,
  from,
  to,
  drawId,
  defaultDrawId,
  scope,
  agentId,
  tab,
  draws,
  agents,
}: {
  query: string;
  from: string;
  to: string;
  /** งวดที่ผู้ใช้เลือกเองใน URL ("" = ใช้ค่าเริ่มต้นของขอบเขต) */
  drawId: string;
  /** งวดที่กรองอยู่จริง เช่นงวดปัจจุบันที่ระบบเลือกให้ */
  defaultDrawId: string;
  /** ขอบเขตงวด: current | past | all */
  scope: "current" | "past" | "all";
  agentId: string;
  tab: string;
  draws: Option[];
  /** null เมื่อผู้ใช้เป็น Agent ซึ่งเห็นเฉพาะบิลของตนเอง */
  agents: Option[] | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(query);
  const [range, setRange] = useState({ startDate: from, endDate: to });
  const [draw, setDraw] = useState(drawId);
  const [agent, setAgent] = useState(agentId);
  const hasFilter = Boolean(q || range.startDate || range.endDate || draw || agent);
  const typingTimer = useRef<number | undefined>(undefined);

  // คำค้นที่ส่งไปล่าสุด กันยิงซ้ำเมื่อค่าไม่เปลี่ยน
  const appliedQuery = useRef(query.trim());

  function apply(overrides: Partial<Values> = {}) {
    window.clearTimeout(typingTimer.current);
    const values: Values = { q, from: range.startDate, to: range.endDate, draw, agent, ...overrides };
    values.q = values.q.trim();
    appliedQuery.current = values.q;

    const params = new URLSearchParams();
    if (tab !== "ALL") params.set("tab", tab);
    if (scope !== "current") params.set("scope", scope);
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
    // replace แทน push: พิมพ์ค้นหาไม่ควรสร้างประวัติย้อนกลับทีละตัวอักษร
    router.replace(`/bills${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  useEffect(() => () => window.clearTimeout(typingTimer.current), []);

  function onType(value: string) {
    setQ(value);
    window.clearTimeout(typingTimer.current);
    if (value.trim() === appliedQuery.current) return;
    typingTimer.current = window.setTimeout(() => apply({ q: value }), TYPING_DELAY_MS);
  }

  function onRangeChange(value: { startDate: string; endDate: string }) {
    setRange(value);
    const complete = Boolean(value.startDate && value.endDate);
    const cleared = !value.startDate && !value.endDate;
    if (complete || (cleared && (range.startDate || range.endDate))) {
      apply({ from: value.startDate, to: value.endDate });
    }
  }

  function clearAll() {
    setQ("");
    setRange({ startDate: "", endDate: "" });
    setDraw("");
    setAgent("");
    apply({ q: "", from: "", to: "", draw: "", agent: "" });
  }

  return (
    <form
      className={`slip-filter-card ${agents ? "has-agent" : ""}`}
      aria-label="ค้นหาและกรองประวัติรายการ"
      onSubmit={(event) => { event.preventDefault(); apply(); }}
    >
      <label className="slip-search">
        <span className="sr-only">ค้นหาเลขบิลหรือชื่อลูกค้า</span>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input name="q" type="search" value={q} onChange={(event) => onType(event.target.value)} placeholder="ค้นหาเลขบิล / ชื่อลูกค้า" />
      </label>
      <div className="slip-filter-dates">
        <DateRangePicker
          startLabel="ตั้งแต่"
          endLabel="ถึงวันที่"
          startPlaceholder="เลือกวันที่"
          endPlaceholder="เลือกวันที่"
          startDate={range.startDate}
          endDate={range.endDate}
          onChange={onRangeChange}
        />
      </div>
      <label className="slip-filter-select slip-filter-draw">
        <span>งวด</span>
        <select value={draw || defaultDrawId} onChange={(event) => { setDraw(event.target.value); apply({ draw: event.target.value }); }}>
          {scope === "current"
            ? draws.length === 0 && <option value="">ไม่มีงวดปัจจุบัน</option>
            : <option value="">{scope === "past" ? "ทุกงวดย้อนหลัง" : "ทุกงวด"}</option>}
          {draws.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
      {agents && (
        <label className="slip-filter-select slip-filter-agent">
          <span>Agent</span>
          <select value={agent} onChange={(event) => { setAgent(event.target.value); apply({ agent: event.target.value }); }}>
            <option value="">ทุก Agent</option>
            {agents.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )}
      <div className="slip-filter-actions">
        <button type="button" className="slip-clear-filter" disabled={!hasFilter} onClick={clearAll}>
          ล้างตัวกรอง
        </button>
      </div>
    </form>
  );
}

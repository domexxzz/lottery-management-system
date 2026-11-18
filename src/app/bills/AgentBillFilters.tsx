"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DateRangePicker } from "@/components/calendar";
import { AppDropdown } from "../AppDropdown";

type Option = { value: string; label: string; lotteryType?: string };

type Values = { q: string; from: string; to: string; draw: string; agent: string; pageSize: string; sort: string };

/** วันที่ในรูป YYYY-MM-DD → "18 พ.ย. 69" สำหรับชิปตัวกรอง */
function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
}

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
  lottery,
  agentId,
  tab,
  pageSize,
  sort,
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
  /** ประเภทหวยที่เลือกอยู่ ("" = ทุกประเภท) ต้องคงไว้ตอนเปลี่ยนตัวกรองอื่น */
  lottery: string;
  agentId: string;
  tab: string;
  pageSize: 10 | 25 | 50 | 100;
  sort: "newest" | "oldest" | "stake_desc" | "payout_desc";
  draws: Option[];
  /** null เมื่อผู้ใช้เป็น Agent ซึ่งเห็นเฉพาะบิลของตนเอง */
  agents: Option[] | null;
}) {
  const router = useRouter();
  const [q, setQ] = useState(query);
  const [range, setRange] = useState({ startDate: from, endDate: to });
  const [draw, setDraw] = useState(drawId);
  const [agent, setAgent] = useState(agentId);
  const [size, setSize] = useState(String(pageSize));
  const [order, setOrder] = useState(sort);
  const hasFilter = Boolean(q || range.startDate || range.endDate || draw || agent || size !== "10" || order !== "newest");
  const typingTimer = useRef<number | undefined>(undefined);

  // คำค้นที่ส่งไปล่าสุด กันยิงซ้ำเมื่อค่าไม่เปลี่ยน
  const appliedQuery = useRef(query.trim());

  function apply(overrides: Partial<Values> = {}) {
    window.clearTimeout(typingTimer.current);
    const values: Values = { q, from: range.startDate, to: range.endDate, draw, agent, pageSize: size, sort: order, ...overrides };
    values.q = values.q.trim();
    appliedQuery.current = values.q;

    const params = new URLSearchParams();
    if (tab !== "ALL") params.set("tab", tab);
    if (scope !== "current") params.set("scope", scope);
    if (lottery) params.set("lottery", lottery);
    for (const [key, value] of Object.entries(values)) {
      if (!value || (key === "pageSize" && value === "10") || (key === "sort" && value === "newest")) continue;
      params.set(key, value);
    }
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
    setSize("10");
    setOrder("newest");
    apply({ q: "", from: "", to: "", draw: "", agent: "", pageSize: "10", sort: "newest" });
  }

  // มือถือ: ด้านบนเหลือช่องค้นหากับปุ่ม "ตัวกรอง" ตัวกรองที่เหลือเปิดเป็น Bottom Sheet
  // บนจอใหญ่ CSS แสดงทุกช่องเรียงแถวเดียวเหมือนเดิม state นี้จึงไม่มีผล
  const [sheetOpen, setSheetOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  function closeSheet() {
    setSheetOpen(false);
    toggleRef.current?.focus();
  }
  useEffect(() => {
    if (!sheetOpen) return;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      // ปฏิทินและ dropdown ที่ซ้อนอยู่จัดการ Escape เองก่อน
      if (event.key === "Escape" && !document.querySelector(".calendar-popover, .app-dropdown-menu")) {
        setSheetOpen(false);
        toggleRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  // ตัวกรองที่ใช้อยู่ แสดงเป็นชิปใต้ช่องค้นหาบนมือถือ กดชิปเพื่อเอาตัวกรองนั้นออก
  const chips: { key: string; label: string; clear: () => void }[] = [];
  if (draw) {
    chips.push({ key: "draw", label: draws.find((option) => option.value === draw)?.label ?? "งวดที่เลือก", clear: () => { setDraw(""); apply({ draw: "" }); } });
  }
  if (agent && agents) {
    chips.push({ key: "agent", label: agents.find((option) => option.value === agent)?.label ?? "Agent ที่เลือก", clear: () => { setAgent(""); apply({ agent: "" }); } });
  }
  if (range.startDate && range.endDate) {
    chips.push({ key: "dates", label: `${shortDate(range.startDate)} – ${shortDate(range.endDate)}`, clear: () => { setRange({ startDate: "", endDate: "" }); apply({ from: "", to: "" }); } });
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
      <button
        ref={toggleRef}
        type="button"
        className="slip-filter-toggle"
        aria-expanded={sheetOpen}
        aria-controls="slip-filter-sheet"
        onClick={() => setSheetOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        ตัวกรอง
        {chips.length > 0 && <b aria-label={`ใช้อยู่ ${chips.length} รายการ`}>{chips.length}</b>}
      </button>
      {chips.length > 0 && (
        <div className="slip-filter-chips" aria-label="ตัวกรองที่ใช้อยู่">
          {chips.map((chip) => (
            <button key={chip.key} type="button" onClick={chip.clear} aria-label={`เอาตัวกรอง ${chip.label} ออก`}>
              <span>{chip.label}</span><i aria-hidden="true">×</i>
            </button>
          ))}
        </div>
      )}
      {sheetOpen && <button type="button" className="slip-filter-backdrop" aria-label="ปิดตัวกรอง" tabIndex={-1} onClick={closeSheet} />}
      <div
        id="slip-filter-sheet"
        className={`slip-filter-sheet ${sheetOpen ? "is-open" : ""}`}
        role={sheetOpen ? "dialog" : undefined}
        aria-modal={sheetOpen ? true : undefined}
        aria-labelledby={sheetOpen ? "slip-filter-sheet-heading" : undefined}
      >
      <header className="slip-filter-sheet-head">
        <h2 id="slip-filter-sheet-heading">ตัวกรอง</h2>
        <button ref={closeRef} type="button" aria-label="ปิดตัวกรอง" onClick={closeSheet}>×</button>
      </header>
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
        <AppDropdown
          ariaLabel="เลือกงวด"
          value={draw || defaultDrawId}
          onValueChange={(value) => { setDraw(value); apply({ draw: value }); }}
          searchable={draws.length > 8}
          searchPlaceholder="ค้นหางวด"
          options={[
            ...(scope === "current"
              ? (draws.length === 0 ? [{ value: "", label: "ไม่มีงวดปัจจุบัน" }] : !lottery ? [{ value: "", label: "ทุกงวดปัจจุบัน" }] : [])
              : [{ value: "", label: scope === "past" ? "ทุกงวดย้อนหลัง" : "ทุกงวด" }]),
            ...draws,
          ]}
        />
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
      <label className="slip-filter-select">
        <span>เรียงข้อมูล</span>
        <AppDropdown ariaLabel="เรียงข้อมูล" value={order} onValueChange={(value) => { setOrder(value as typeof order); apply({ sort: value }); }} options={[{ value: "newest", label: "วันที่ ใหม่→เก่า" }, { value: "oldest", label: "วันที่ เก่า→ใหม่" }, { value: "stake_desc", label: "ยอดเดิมพัน มาก→น้อย" }, { value: "payout_desc", label: "เงินรางวัล มาก→น้อย" }]} />
      </label>
      <label className="slip-filter-select">
        <span>รายการต่อหน้า</span>
        <AppDropdown ariaLabel="จำนวนรายการต่อหน้า" value={size} onValueChange={(value) => { setSize(value); apply({ pageSize: value }); }} options={[10, 25, 50, 100].map((value) => ({ value: String(value), label: `${value} รายการ` }))} />
      </label>
      <div className="slip-filter-actions">
        <button type="button" className="slip-clear-filter" disabled={!hasFilter} onClick={clearAll}>
          ล้างตัวกรอง
        </button>
        <button type="button" className="slip-filter-done" onClick={closeSheet}>ดูผลลัพธ์</button>
      </div>
      </div>
    </form>
  );
}

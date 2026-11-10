"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useMemo, useState } from "react";
import { AppDropdown } from "../AppDropdown";
import { DateRangePicker } from "@/components/calendar";
import type { MonthShortcut } from "@/lib/draws/range";

export type AgentTableCustomer = {
  key: string;
  name: string;
  billCount: number;
  gross: number;
  profileHref: string;
};

export type AgentTableRow = {
  id: string;
  code: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED";
  commissionRate: number;
  customerCount: number;
  sales: number;
  billCount: number;
  payout: number;
  commission: number;
  net: number;
  profileHref: string;
  csvHref: string;
  customers: AgentTableCustomer[];
};

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS_LABEL = { ACTIVE: "ใช้งาน", SUSPENDED: "ระงับ", CLOSED: "ปิด" } as const;
const STATUS_TONE = { ACTIVE: "success", SUSPENDED: "warning", CLOSED: "muted" } as const;

/** ตาราง Agent แบบอ่านง่าย: หนึ่งแถวต่อ Agent กดขยายดูลูกค้าอันดับแรกได้ */
const RANGE_VALUE = "__range";
const PAGE_SIZE = 10;

export function AgentTable({
  draws,
  selectedDrawId,
  from,
  to,
  months,
  rangeDraws,
  shortcuts,
  csvHref,
  agents,
}: {
  /** คีย์ลัด วันนี้ / งวดนี้ / เดือนนี้ (YYYY-MM-DD เวลาไทย) */
  shortcuts: { today: string; monthFrom: string; monthTo: string; drawId: string };
  draws: { id: string; name: string }[];
  selectedDrawId: string;
  /** ช่วงวันที่ออกรางวัล YYYY-MM-DD ว่าง = ไม่กรองตามวันที่ */
  from: string;
  to: string;
  months: MonthShortcut[];
  /** ชื่องวดที่อยู่ในช่วงวันที่ที่เลือก */
  rangeDraws: string[];
  csvHref: string;
  agents: AgentTableRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  // รูปแบบการแสดงผล: การ์ด (ค่าเริ่มต้น) หรือตาราง
  const [view, setView] = useState<"table" | "card">("card");

  const rows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("th-TH");
    return agents.filter((agent) => {
      if (status && agent.status !== status) return false;
      if (!term) return true;
      return `${agent.code} ${agent.name}`.toLocaleLowerCase("th-TH").includes(term)
        || agent.customers.some((customer) => customer.name.toLocaleLowerCase("th-TH").includes(term));
    });
  }, [agents, search, status]);

  const totals = rows.reduce(
    (sum, agent) => ({
      customers: sum.customers + agent.customerCount,
      bills: sum.bills + agent.billCount,
      sales: sum.sales + agent.sales,
      payout: sum.payout + agent.payout,
      commission: sum.commission + agent.commission,
    }),
    { customers: 0, bills: 0, sales: 0, payout: 0, commission: 0 },
  );

  // แสดงทีละ 10 Agent ที่เหลือกดหน้าถัดไป · ยอดรวมท้ายตารางยังคิดจากทุก Agent ที่ตรงตัวกรอง
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstShown = rows.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(currentPage * PAGE_SIZE, rows.length);

  const byRange = Boolean(from || to);
  const [range, setRange] = useState({ startDate: from, endDate: to });

  function navigate(update: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    update(params);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`, { scroll: false });
  }

  /** เลือกงวดเดียว ล้างช่วงวันที่ */
  function changeDraw(value: string) {
    if (value === RANGE_VALUE) return;
    setRange({ startDate: "", endDate: "" });
    navigate((params) => {
      params.delete("from");
      params.delete("to");
      if (value) params.set("drawId", value); else params.delete("drawId");
    });
  }

  /** ใช้ช่วงวันที่ ล้างการเลือกงวดเดียว */
  function applyRange(startDate: string, endDate: string) {
    setRange({ startDate, endDate });
    navigate((params) => {
      params.delete("drawId");
      if (startDate) params.set("from", startDate); else params.delete("from");
      if (endDate) params.set("to", endDate); else params.delete("to");
    });
  }

  function onRangeChange(value: { startDate: string; endDate: string }) {
    setRange(value);
    // รอจนเลือกครบสองวันก่อนค่อยโหลดใหม่ ไม่งั้นตารางกระพริบตอนกดวันแรก
    if (value.startDate && value.endDate) applyRange(value.startDate, value.endDate);
    if (!value.startDate && !value.endDate && byRange) applyRange("", "");
  }

  return <section className="agent-table-card" aria-label="ตาราง Agent">
    <div className="agent-table-toolbar">
      <label className="agent-table-search">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="ค้นหา Agent หรือลูกค้า" aria-label="ค้นหา Agent หรือลูกค้า" />
      </label>
      <AppDropdown ariaLabel="เลือกงวด" value={byRange ? RANGE_VALUE : selectedDrawId} onValueChange={changeDraw} options={[...(byRange ? [{ value: RANGE_VALUE, label: "ตามช่วงวันที่" }] : []), { value: "", label: "ทุกงวด" }, ...draws.map((draw) => ({ value: draw.id, label: draw.name }))]} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" />
      <AppDropdown ariaLabel="เลือกสถานะ Agent" value={status} onValueChange={(value) => { setStatus(value); setPage(1); }} options={[{ value: "", label: "ทุกสถานะ" }, { value: "ACTIVE", label: "ใช้งาน" }, { value: "SUSPENDED", label: "ระงับ" }, { value: "CLOSED", label: "ปิด" }]} />
      <div className="agent-view-switch" role="group" aria-label="รูปแบบการแสดงผล">
        <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>ตาราง</button>
        <button type="button" aria-pressed={view === "card"} onClick={() => setView("card")}>การ์ด</button>
      </div>
      <a className="agent-table-csv" href={csvHref}>ดาวน์โหลด CSV</a>
    </div>

    <div className="agent-table-period" role="group" aria-label="ดูยอดตามช่วงวันที่">
      <div className="agent-table-dates">
        <DateRangePicker startLabel="ตั้งแต่วันที่" endLabel="ถึงวันที่" startPlaceholder="เลือกวันที่" endPlaceholder="เลือกวันที่" startDate={range.startDate} endDate={range.endDate} onChange={onRangeChange} />
      </div>
      <div className="agent-table-months">
        <span>ดูทั้งเดือน (เมนูลัด)</span>
        <div>
          <AppDropdown
            ariaLabel="ดูทั้งเดือน"
            placeholder="เลือกเดือน"
            value={months.find((month) => month.from === from && month.to === to)?.key ?? ""}
            onValueChange={(key) => {
              const month = months.find((item) => item.key === key);
              if (month) applyRange(month.from, month.to);
            }}
            options={months.map((month) => ({ value: month.key, label: month.name }))}
          />
          {byRange && <button type="button" className="agent-table-clear" onClick={() => applyRange("", "")}>ล้างช่วงวันที่</button>}
        </div>
      </div>
      <div className="agent-table-shortcuts">
        <span>คีย์ลัด</span>
        <div role="group" aria-label="คีย์ลัดช่วงเวลา">
          <button type="button" aria-pressed={from === shortcuts.today && to === shortcuts.today} onClick={() => applyRange(shortcuts.today, shortcuts.today)}>วันนี้</button>
          <button type="button" aria-pressed={!byRange && Boolean(shortcuts.drawId) && selectedDrawId === shortcuts.drawId} disabled={!shortcuts.drawId} onClick={() => changeDraw(shortcuts.drawId)}>งวดนี้</button>
          <button type="button" aria-pressed={from === shortcuts.monthFrom && to === shortcuts.monthTo} onClick={() => applyRange(shortcuts.monthFrom, shortcuts.monthTo)}>เดือนนี้</button>
        </div>
      </div>
      {byRange && <p className="agent-table-range-note">
        {rangeDraws.length === 0 ? "ไม่มีงวดที่ออกรางวัลในช่วงนี้" : `รวม ${rangeDraws.length} งวด: ${rangeDraws.slice().reverse().join(", ")}`}
      </p>}
    </div>

    {view === "card" ? <>
      {rows.length === 0 ? <p className="agent-table-empty agent-card-empty">ไม่พบ Agent ที่ค้นหา</p> : <ol className="agent-card-grid">
        {pageRows.map((agent) => <li key={agent.id} className={`agent-grid-card is-${agent.status.toLowerCase()}`}>
          <header>
            <span className="agent-table-name"><strong>{agent.code}</strong><small>{agent.name}</small></span>
            <span className={`agent-table-status ${STATUS_TONE[agent.status]}`}>{STATUS_LABEL[agent.status]}</span>
          </header>
          <div className="agent-grid-sales"><span>ยอดขาย</span><strong>{MONEY.format(agent.sales)}<small> บาท</small></strong></div>
          <dl>
            <div><dt>จ่ายรางวัล</dt><dd>{MONEY.format(agent.payout)}</dd></div>
            <div><dt>คอม ({agent.commissionRate.toFixed(0)}%)</dt><dd>{MONEY.format(agent.commission)}</dd></div>
            <div><dt>ลูกค้า</dt><dd>{agent.customerCount.toLocaleString("th-TH")} คน</dd></div>
            <div><dt>บิล</dt><dd>{agent.billCount.toLocaleString("th-TH")} บิล</dd></div>
          </dl>
          {agent.customers.length > 0 && <p className="agent-grid-top-customer">ลูกค้าอันดับ 1: <Link href={agent.customers[0]!.profileHref}>{agent.customers[0]!.name}</Link> · {MONEY.format(agent.customers[0]!.gross)} ฿</p>}
          <Link href={agent.profileHref} className="agent-grid-profile">ดูรายละเอียด</Link>
        </li>)}
      </ol>}
      {rows.length > 0 && <div className="agent-card-totals" aria-label="ยอดรวม">
        <span>รวมทั้งหมด <b>{rows.length}</b> Agent</span>
        <span>ลูกค้า <b>{totals.customers.toLocaleString("th-TH")}</b></span>
        <span>บิล <b>{totals.bills.toLocaleString("th-TH")}</b></span>
        <span>ยอดขาย <b>{MONEY.format(totals.sales)}</b></span>
        <span>จ่ายรางวัล <b>{MONEY.format(totals.payout)}</b></span>
        <span>คอม <b>{MONEY.format(totals.commission)}</b></span>
      </div>}
    </> : <div className="table-wrap agent-table-wrap">
      <table className="agent-table">
        <thead>
          <tr>
            <th scope="col">Agent</th>
            <th scope="col">สถานะ</th>
            <th scope="col" className="num">ลูกค้า</th>
            <th scope="col" className="num">บิล</th>
            <th scope="col" className="num">ยอดขาย</th>
            <th scope="col" className="num">จ่ายรางวัล</th>
            <th scope="col" className="num">คอม</th>
            <th scope="col"><span className="sr-only">จัดการ</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={8} className="agent-table-empty">ไม่พบ Agent ที่ค้นหา</td></tr>}
          {pageRows.map((agent) => {
            const open = openId === agent.id;
            return <Fragment key={agent.id}>
              <tr className={open ? "is-open" : undefined}>
                <td><div className="agent-table-agent">
                  <button type="button" className="agent-table-toggle" aria-expanded={open} onClick={() => setOpenId(open ? null : agent.id)} disabled={agent.customers.length === 0} aria-label={`${open ? "ซ่อน" : "ดู"}ลูกค้าของ ${agent.code}`}>{open ? "▾" : "▸"}</button>
                  <span className="agent-table-name"><strong>{agent.code}</strong><small>{agent.name}</small></span>
                </div></td>
                <td><span className={`agent-table-status ${STATUS_TONE[agent.status]}`}>{STATUS_LABEL[agent.status]}</span></td>
                <td className="num">{agent.customerCount}</td>
                <td className="num">{agent.billCount}</td>
                <td className="num"><strong>{MONEY.format(agent.sales)}</strong></td>
                <td className="num">{MONEY.format(agent.payout)}</td>
                <td className="num">{MONEY.format(agent.commission)}<small> ({agent.commissionRate.toFixed(0)}%)</small></td>
                <td className="agent-table-link"><Link href={agent.profileHref}>ดูรายละเอียด</Link></td>
              </tr>
              {open && <tr className="agent-table-customers">
                <td colSpan={8}>
                  <div>
                    <span>ลูกค้าอันดับแรกตามยอดซื้อ</span>
                    <ol>
                      {agent.customers.map((customer) => <li key={customer.key}>
                        <Link href={customer.profileHref}>{customer.name}</Link>
                        <small>{customer.billCount} บิล</small>
                        <b>{MONEY.format(customer.gross)} ฿</b>
                      </li>)}
                    </ol>
                    {agent.customerCount > agent.customers.length && <Link className="agent-table-more" href={agent.profileHref}>ดูลูกค้าทั้งหมด {agent.customerCount} คน →</Link>}
                  </div>
                </td>
              </tr>}
            </Fragment>;
          })}
        </tbody>
        {rows.length > 0 && <tfoot>
          <tr>
            <th scope="row" colSpan={2}>รวมทั้งหมด {rows.length} Agent</th>
            <td className="num">{totals.customers}</td>
            <td className="num">{totals.bills}</td>
            <td className="num"><strong>{MONEY.format(totals.sales)}</strong></td>
            <td className="num">{MONEY.format(totals.payout)}</td>
            <td className="num">{MONEY.format(totals.commission)}</td>
            <td />
          </tr>
        </tfoot>}
      </table>
    </div>}

    {rows.length > 0 && <nav className="agent-table-pager" aria-label="เปลี่ยนหน้าตาราง Agent">
      <span>แสดง {firstShown}–{lastShown} จาก {rows.length} Agent</span>
      {pageCount > 1 && <div>
        <button type="button" onClick={() => { setPage(currentPage - 1); setOpenId(null); }} disabled={currentPage === 1}>‹ ก่อนหน้า</button>
        {Array.from({ length: pageCount }, (_, index) => index + 1).map((number) => (
          <button key={number} type="button" aria-current={number === currentPage ? "page" : undefined} onClick={() => { setPage(number); setOpenId(null); }}>{number}</button>
        ))}
        <button type="button" onClick={() => { setPage(currentPage + 1); setOpenId(null); }} disabled={currentPage === pageCount}>ถัดไป ›</button>
      </div>}
    </nav>}
  </section>;
}

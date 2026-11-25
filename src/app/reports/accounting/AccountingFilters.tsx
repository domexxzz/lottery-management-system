"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { DateRangePicker, type DateRangeValue } from "@/components/calendar";
import { AppDropdown } from "../../AppDropdown";
import { DashboardIcon as Icon } from "../../DashboardIcon";
import { LotteryFlag } from "../../bills/ThaiFlag";
import {
  ACCOUNTING_LOTTERIES,
  accountingHref,
  defaultCompareValues,
  type AccountingCompareCategory,
  type AccountingLottery,
  type AccountingQuery,
  type CompareUnit,
} from "@/lib/reports/accounting-period";

type Option = { value: string; label: string; lotteryType?: string };
type Category = "ALL" | AccountingCompareCategory;

const CATEGORY_LABEL: Record<AccountingCompareCategory, string> = {
  THAI_GOVERNMENT: "หวยรัฐบาล",
  LAO_COMBINED: "หวยลาวและหวยลาวชุด",
};

const PAIRS: { a: AccountingCompareCategory; b: AccountingCompareCategory; label: string }[] = [
  { a: "THAI_GOVERNMENT", b: "LAO_COMBINED", label: "ทั้งหมด (ไทย ↔ ลาว)" },
  { a: "THAI_GOVERNMENT", b: "THAI_GOVERNMENT", label: "ไทย ↔ ไทย" },
  { a: "LAO_COMBINED", b: "LAO_COMBINED", label: "ลาว ↔ ลาว" },
];

const METHODS: { value: CompareUnit; label: string; description: string }[] = [
  { value: "draw", label: "เลือกงวด", description: "งวดเฉพาะ หรือทุกงวด" },
  { value: "range", label: "เลือกช่วงวันที่", description: "กำหนดวันเริ่ม–สิ้นสุด" },
  { value: "month", label: "เลือกเดือน", description: "รวมข้อมูลทั้งเดือน" },
];

function CompareRangeField({ from, to, onChange }: { from: string; to: string; onChange: (value: DateRangeValue) => void }) {
  const [value, setValue] = useState<DateRangeValue>({ startDate: from, endDate: to });
  useEffect(() => setValue({ startDate: from, endDate: to }), [from, to]);
  return <DateRangePicker
    startLabel="วันเริ่มต้น" endLabel="วันสิ้นสุด"
    startPlaceholder="เลือกวันเริ่มต้น" endPlaceholder="เลือกวันสิ้นสุด"
    startDate={value.startDate} endDate={value.endDate}
    onChange={(next) => {
      setValue(next);
      if (next.startDate && next.endDate) onChange(next);
    }}
  />;
}

function CompareSide({ side, category, unit, drawValue, monthValue, range, draws, months, onDraw, onMonth, onRange }: {
  side: "A" | "B"; category: AccountingCompareCategory; unit: CompareUnit;
  drawValue: string; monthValue: string; range: { from: string; to: string };
  draws: Option[]; months: Option[];
  onDraw: (value: string) => void; onMonth: (value: string) => void; onRange: (value: DateRangeValue) => void;
}) {
  const choices = draws.filter((draw) => draw.lotteryType === category);
  return <article className={`acc-compare-side acc-compare-side-${side.toLowerCase()}`}>
    <header><div className="acc-side-title"><span>{side}</span><span><b>ช่วง {side}</b><small>{side === "A" ? "ข้อมูลหลัก" : "ข้อมูลเปรียบเทียบ"}</small></span></div><strong><LotteryFlag lotteryType={category === "THAI_GOVERNMENT" ? "THAI_GOVERNMENT" : "LAO"} /> {CATEGORY_LABEL[category]}</strong></header>
    {unit === "draw" ? <AppDropdown
      ariaLabel={`เลือกงวดช่วง ${side}`} value={drawValue || "all"} searchable={choices.length > 8} searchPlaceholder="ค้นหางวด"
      onValueChange={(value) => { if (value) onDraw(value); }}
      options={[{ value: "all", label: `รวมทุกงวด ${CATEGORY_LABEL[category]}` }, ...choices]}
    /> : unit === "range" ? <CompareRangeField from={range.from} to={range.to} onChange={onRange} /> : <AppDropdown
      ariaLabel={`เลือกเดือนช่วง ${side}`} value={monthValue}
      onValueChange={(value) => { if (value) onMonth(value); }} options={months}
    />}
  </article>;
}

export function AccountingFilters({ query, range, agents, months, draws, drawA, drawB }: {
  query: AccountingQuery; range: { from: string; to: string };
  agents: { id: string; label: string }[]; months: Option[]; draws: Option[]; drawA: string; drawB: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [calendarRange, setCalendarRange] = useState({ startDate: range.from, endDate: range.to });
  const go = (change: Partial<AccountingQuery>) => startTransition(() => router.replace(accountingHref(pathname, query, change), { scroll: false }));
  const customMode = query.compare === "custom";
  const activeMethod = METHODS.some((method) => method.value === query.compareUnit) ? query.compareUnit : "month";
  useEffect(() => setCalendarRange({ startDate: range.from, endDate: range.to }), [range.from, range.to]);

  function updateCalendarRange(value: DateRangeValue) {
    setCalendarRange(value);
    const complete = Boolean(value.startDate && value.endDate);
    const cleared = !value.startDate && !value.endDate;
    if (!complete && !cleared) return;
    go({ period: complete ? "custom" : "all", from: value.startDate, to: value.endDate, drawIds: undefined, compare: "none" });
  }

  const activeCategory: Category = query.lotteries.length === ACCOUNTING_LOTTERIES.length ? "ALL"
    : query.lotteries.includes("THAI_GOVERNMENT") ? "THAI_GOVERNMENT" : "LAO_COMBINED";
  const categoryLotteries = (category: Category): AccountingLottery[] => category === "ALL" ? [...ACCOUNTING_LOTTERIES]
    : category === "THAI_GOVERNMENT" ? ["THAI_GOVERNMENT"] : ["LAO", "LAO_SET"];
  const reportRows: { category: Category; label: string; flag?: string }[] = [
    { category: "ALL", label: "ทุกประเภท" },
    { category: "THAI_GOVERNMENT", label: "หวยรัฐบาล", flag: "THAI_GOVERNMENT" },
    { category: "LAO_COMBINED", label: "หวยลาวและหวยลาวชุด", flag: "LAO" },
  ];

  return <section className={`acc-filters ${pending ? "is-loading" : ""}`} aria-label="เลือกช่วงเวลาและตัวกรอง" aria-busy={pending}>
    {!customMode && <>
      <div className="acc-calendar-filter">
        <div className="acc-calendar-heading"><strong>เลือกช่วงวันที่</strong><small>ข้อมูลอ้างอิงวันออกรางวัลของงวด</small></div>
        <DateRangePicker startLabel="วันเริ่มต้น" endLabel="วันสิ้นสุด" startPlaceholder="เลือกวันเริ่มต้น" endPlaceholder="เลือกวันสิ้นสุด" startDate={calendarRange.startDate} endDate={calendarRange.endDate} onChange={updateCalendarRange} />
      </div>
      <div className="acc-report-picker" aria-label="เลือกประเภทหวยและงวด">
        {reportRows.map((row) => {
          const choices = row.category === "ALL" ? draws : draws.filter((draw) => draw.lotteryType === row.category);
          const active = activeCategory === row.category;
          const selectedDraw = query.drawIds?.[0] ?? "all";
          const value = active && choices.some((draw) => draw.value === selectedDraw) ? selectedDraw : "all";
          return <div className="acc-report-picker-row" key={row.category}>
            <button type="button" className="acc-report-type" aria-pressed={active} onClick={() => go({ lotteries: categoryLotteries(row.category), drawIds: undefined })}>{row.flag && <LotteryFlag lotteryType={row.flag} />}{row.label}</button>
            <AppDropdown ariaLabel={`เลือกงวด ${row.label}`} value={value} searchable={choices.length > 8} searchPlaceholder="ค้นหางวด"
              onValueChange={(next) => {
                if (!next) return;
                const selected = choices.find((draw) => draw.value === next);
                const category = row.category === "ALL" && selected ? selected.lotteryType as Category : row.category;
                go({ lotteries: categoryLotteries(category), drawIds: next === "all" ? undefined : [next] });
              }}
              options={[{ value: "all", label: row.category === "ALL" ? "รวมทุกงวด ทุกประเภท" : `รวมทุกงวด ${row.label}` }, ...choices]}
            />
          </div>;
        })}
      </div>
      <div className="acc-filter-line acc-filter-extra"><label className="acc-agent-filter"><span className="acc-filter-label">Agent</span><AppDropdown searchable={agents.length > 8} value={query.agentId} onValueChange={(value) => go({ agentId: value })} options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.label }))]} /></label></div>
    </>}

    <section className={`acc-compare-card ${customMode ? "is-active" : ""}`} aria-labelledby="acc-compare-heading">
      <header className="acc-compare-header">
        <div><span className="acc-compare-heading-icon"><Icon name="analytics" /></span><span><strong id="acc-compare-heading">เปรียบเทียบข้อมูล</strong><small>ทำตาม 4 ขั้นตอนจากบนลงล่าง</small></span></div>
        <nav className="acc-compare-toggle" aria-label="เปิดหรือปิดการเปรียบเทียบ">
          <button type="button" aria-pressed={!customMode} onClick={() => go({ compare: "none" })}>ไม่เปรียบเทียบ</button>
          <button type="button" className="is-primary" aria-pressed={customMode} onClick={() => go({ compare: "custom" })}><Icon name="analytics" /> เริ่มเปรียบเทียบ</button>
        </nav>
      </header>

      {customMode && <div className="acc-compare-steps">
        <div className="acc-compare-step">
          <div className="acc-step-title"><b>1</b><i><Icon name="draw" /></i><span><strong>เลือกคู่หวย</strong><small>เลือกประเภทหวยของช่วง A และ B</small></span></div>
          <div className="acc-pair-options">{PAIRS.map((pair) => {
            const active = pair.a === pair.b
              ? query.compareLotteryA === pair.a && query.compareLotteryB === pair.b
              : query.compareLotteryA !== query.compareLotteryB;
            return <button key={pair.label} type="button" aria-pressed={active} onClick={() => go({ compareLotteryA: pair.a, compareLotteryB: pair.b, compareA: "", compareB: "" })}>
              <span className="acc-pair-flags"><LotteryFlag lotteryType={pair.a === "THAI_GOVERNMENT" ? "THAI_GOVERNMENT" : "LAO"} />{pair.a !== pair.b && <LotteryFlag lotteryType="LAO" />}</span>
              <strong>{pair.label}</strong>{active && <Icon name="check" />}
            </button>;
          })}</div>
        </div>

        <div className="acc-compare-step">
          <div className="acc-step-title"><b>2</b><i><Icon name="filter" /></i><span><strong>เลือกวิธีเปรียบเทียบ</strong><small>เลือกงวด ช่วงวันที่ หรือเดือน</small></span></div>
          <div className="acc-method-options">{METHODS.map((method) => <button key={method.value} type="button" aria-pressed={activeMethod === method.value}
            onClick={() => { const defaults = defaultCompareValues(method.value); go({ compareUnit: method.value, compareA: defaults.a, compareB: defaults.b }); }}>
            <Icon name={method.value === "draw" ? "draw" : "calendar"} /><span><strong>{method.label}</strong><small>{method.description}</small></span>{activeMethod === method.value && <Icon name="check" />}
          </button>)}</div>
        </div>

        <div className="acc-compare-step">
          <div className="acc-step-title"><b>3</b><i><Icon name="analytics" /></i><span><strong>เลือกข้อมูลสองฝั่ง</strong><small>A คือข้อมูลหลัก · B คือข้อมูลเปรียบเทียบ</small></span></div>
          <div className="acc-compare-sides">
            <CompareSide side="A" category={query.compareLotteryA} unit={activeMethod} drawValue={drawA} monthValue={query.compareA} range={{ from: query.compareAFrom, to: query.compareATo }} draws={draws} months={months}
              onDraw={(value) => go({ compareA: value === "all" ? "" : value })} onMonth={(value) => go({ compareA: value })} onRange={(value) => go({ compareAFrom: value.startDate, compareATo: value.endDate })} />
            <button type="button" className="acc-compare-vs" title="สลับข้อมูลช่วง A และ B" aria-label="สลับข้อมูลช่วง A และ B" onClick={() => go({
              compareLotteryA: query.compareLotteryB,
              compareLotteryB: query.compareLotteryA,
              compareA: query.compareB,
              compareB: query.compareA,
              compareAFrom: query.compareBFrom,
              compareATo: query.compareBTo,
              compareBFrom: query.compareAFrom,
              compareBTo: query.compareATo,
              compareAgentA: query.compareAgentB,
              compareAgentB: query.compareAgentA,
            })}><Icon name="reset" /><span>สลับ</span></button>
            <CompareSide side="B" category={query.compareLotteryB} unit={activeMethod} drawValue={drawB} monthValue={query.compareB} range={{ from: query.compareBFrom, to: query.compareBTo }} draws={draws} months={months}
              onDraw={(value) => go({ compareB: value === "all" ? "" : value })} onMonth={(value) => go({ compareB: value })} onRange={(value) => go({ compareBFrom: value.startDate, compareBTo: value.endDate })} />
          </div>
        </div>

        <div className="acc-compare-agent">
          <div className="acc-step-title"><b>4</b><i><Icon name="agent" /></i><span><strong>เลือก Agent</strong><small>ค่าเริ่มต้นเป็นทุก Agent และเลือกสองฝั่งต่างกันได้</small></span></div>
          <div className="acc-agent-compare-fields">
            <label><span><b>ช่วง A</b><small>Agent ของข้อมูลหลัก</small></span><AppDropdown ariaLabel="เลือก Agent ช่วง A" searchable={agents.length > 8} value={query.compareAgentA} onValueChange={(value) => go({ compareAgentA: value })} options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.label }))]} /></label>
            <label><span><b>ช่วง B</b><small>Agent ของข้อมูลเปรียบเทียบ</small></span><AppDropdown ariaLabel="เลือก Agent ช่วง B" searchable={agents.length > 8} value={query.compareAgentB} onValueChange={(value) => go({ compareAgentB: value })} options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.label }))]} /></label>
          </div>
        </div>
      </div>}
    </section>
    {pending && <span className="acc-loading" role="status">กำลังอัปเดตข้อมูล…</span>}
  </section>;
}

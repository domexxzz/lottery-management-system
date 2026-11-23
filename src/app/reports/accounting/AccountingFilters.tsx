"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { DateRangePicker } from "@/components/calendar";
import { AppDropdown } from "../../AppDropdown";
import { LotteryFlag } from "../../bills/ThaiFlag";
import {
  ACCOUNTING_LOTTERIES,
  ACCOUNTING_MAIN_PERIODS,
  ACCOUNTING_PERIOD_LABELS,
  ACCOUNTING_QUICK_PERIODS,
  accountingHref,
  COMPARE_UNITS,
  COMPARE_UNIT_LABEL,
  defaultCompareValues,
  type AccountingLottery,
  type CompareUnit,
  type AccountingPeriodKind,
  type AccountingQuery,
} from "@/lib/reports/accounting-period";

const periodLabel = (period: AccountingPeriodKind) => (period === "custom" ? "กำหนดเอง" : ACCOUNTING_PERIOD_LABELS[period]);
/** ช่วงที่ไม่อยู่ในชิปหลัก รวมไว้ในเมนู "ช่วงอื่น" */
const OTHER_PERIODS = ACCOUNTING_QUICK_PERIODS.filter((period) => !ACCOUNTING_MAIN_PERIODS.includes(period));

/**
 * ตัวกรองหน้าสรุปบัญชี 3 แถว: ช่วงเวลา · ประเภทหวย · Agent/เทียบช่วงก่อน
 * เปลี่ยนแล้วหน้าโหลดใหม่ทันที ระหว่างโหลดแสดงสถานะให้เห็น
 */
type Option = { value: string; label: string; lotteryType?: string };

/**
 * เลือกค่าหนึ่งฝั่งของการเปรียบเทียบ ตามหน่วยที่เลือก
 * วัน = ปฏิทิน · สัปดาห์/เดือน/งวด = รายการ  (A กับ B จึงเป็นหน่วยเดียวกันเสมอ)
 */
function ComparePicker({ label, unit, value, options, onChange }: {
  label: string;
  unit: CompareUnit;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  // ทุกหน่วยเลือกจากรายการ วันแสดงเป็น "อ. 10 พ.ย. 2569" (ช่องวันที่ของเบราว์เซอร์อาจขึ้นเดือน/วันแบบฝรั่งจนอ่านสลับ)
  return (
    <div className="acc-span-picker">
      <span className="acc-span-label">{label}</span>
      <AppDropdown
        ariaLabel={`${label} (${COMPARE_UNIT_LABEL[unit]})`}
        value={value}
        searchable={options.length > 12}
        searchPlaceholder={`ค้นหา${COMPARE_UNIT_LABEL[unit]}`}
        onValueChange={(next) => { if (next) onChange(next); }}
        options={options}
      />
    </div>
  );
}

export function AccountingFilters({ query, agents, comparison, days, months, weeks, draws, drawA, drawB }: {
  query: AccountingQuery;
  agents: { id: string; label: string }[];
  /** ตัวเลือกของการเปรียบเทียบแบบเลือกเอง (ล่าสุดก่อน) */
  days: Option[];
  months: Option[];
  weeks: Option[];
  draws: Option[];
  /** งวด A/B ที่ใช้อยู่จริง (หน้าเลือกงวดล่าสุดให้เมื่อยังไม่ได้เลือก) */
  drawA: string;
  drawB: string;
  /** ข้อความของการเปรียบเทียบ null = ช่วงที่เลือกเทียบไม่ได้ (เช่น ข้อมูลทั้งหมด) */
  comparison: { button: string; current: string; previous: string } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const go = (change: Partial<AccountingQuery>) => startTransition(() => router.replace(accountingHref(pathname, query, change), { scroll: false }));
  const customMode = query.compare === "custom";
  const otherActive = OTHER_PERIODS.includes(query.period as (typeof OTHER_PERIODS)[number]);
  type Category = "ALL" | "THAI_GOVERNMENT" | "LAO_COMBINED";
  const activeCategory: Category = query.lotteries.length === ACCOUNTING_LOTTERIES.length
    ? "ALL"
    : query.lotteries.includes("THAI_GOVERNMENT") ? "THAI_GOVERNMENT" : "LAO_COMBINED";
  const categoryLotteries = (category: Category): AccountingLottery[] => category === "ALL"
    ? [...ACCOUNTING_LOTTERIES]
    : category === "THAI_GOVERNMENT" ? ["THAI_GOVERNMENT"] : ["LAO", "LAO_SET"];
  const reportRows: { category: Category; label: string; flag?: string }[] = [
    { category: "ALL", label: "ทุกประเภท" },
    { category: "THAI_GOVERNMENT", label: "หวยรัฐบาล", flag: "THAI_GOVERNMENT" },
    { category: "LAO_COMBINED", label: "หวยลาวและหวยลาวชุด", flag: "LAO" },
  ];

  return (
    <section className={`acc-filters ${pending ? "is-loading" : ""}`} aria-label="เลือกช่วงเวลาและตัวกรอง" aria-busy={pending}>
      <div className={`acc-filter-line ${customMode ? "is-muted" : ""}`}>
        <span className="acc-filter-label">ช่วงเวลา</span>
        <nav className="acc-chips" aria-label="ช่วงเวลา">
          {ACCOUNTING_MAIN_PERIODS.map((period) => (
            <button key={period} type="button" aria-pressed={!customMode && query.period === period} onClick={() => go({ period, drawIds: undefined, compare: customMode ? "none" : query.compare })}>{periodLabel(period)}</button>
          ))}
          <span className={`acc-more-period ${otherActive ? "is-active" : ""}`}>
            <AppDropdown
              ariaLabel="ช่วงเวลาอื่น"
              value={otherActive && !customMode ? query.period : ""}
              onValueChange={(value) => { if (value) go({ period: value as AccountingPeriodKind, drawIds: undefined, compare: customMode ? "none" : query.compare }); }}
              options={[{ value: "", label: "ช่วงอื่น…" }, ...OTHER_PERIODS.map((period) => ({ value: period, label: periodLabel(period) }))]}
            />
          </span>
        </nav>
      </div>

      {customMode && (
        <p className="acc-muted-note">กำลังเปรียบเทียบแบบเลือกเอง ตัวเลขทั้งหน้าเป็นของ <b>ช่วง A</b> · กดช่วงเวลาด้านบนเพื่อกลับไปดูตามช่วงเวลาปกติ</p>
      )}

      {query.period === "custom" && !customMode && (
        <div className="acc-custom-range">
          <DateRangePicker
            startLabel="ตั้งแต่วันที่"
            endLabel="ถึงวันที่"
            startPlaceholder="เลือกวันเริ่มต้น"
            endPlaceholder="เลือกวันสิ้นสุด"
            startDate={query.from}
            endDate={query.to}
            onChange={({ startDate, endDate }) => go({ from: startDate, to: endDate })}
          />
        </div>
      )}

      <div className="acc-report-picker" aria-label="เลือกประเภทหวยและงวด">
        {reportRows.map((row) => {
          const choices = row.category === "ALL" ? draws : draws.filter((draw) => draw.lotteryType === row.category);
          const active = activeCategory === row.category;
          const selectedDraw = query.drawIds?.[0] ?? "all";
          const value = active && choices.some((draw) => draw.value === selectedDraw) ? selectedDraw : "all";
          return (
            <div className="acc-report-picker-row" key={row.category}>
              <button
                type="button"
                className="acc-report-type"
                aria-pressed={active}
                onClick={() => go({ lotteries: categoryLotteries(row.category), drawIds: undefined })}
              >
                {row.flag && <LotteryFlag lotteryType={row.flag} />}
                {row.label}
              </button>
              <AppDropdown
                ariaLabel={`เลือกงวด ${row.label}`}
                value={value}
                searchable={choices.length > 8}
                searchPlaceholder="ค้นหางวด"
                onValueChange={(next) => {
                  if (!next) return;
                  const selected = choices.find((draw) => draw.value === next);
                  const category = row.category === "ALL" && selected ? selected.lotteryType as Category : row.category;
                  go({ lotteries: categoryLotteries(category), drawIds: next === "all" ? undefined : [next] });
                }}
                options={[
                  { value: "all", label: row.category === "ALL" ? "รวมทุกงวด ทุกประเภท" : `รวมทุกงวด ${row.label}` },
                  ...choices,
                ]}
              />
            </div>
          );
        })}
      </div>

      <div className="acc-filter-line acc-filter-extra">
        <label className="acc-agent-filter">
          <span className="acc-filter-label">Agent</span>
          <AppDropdown
            searchable={agents.length > 8}
            value={query.agentId}
            onValueChange={(value) => go({ agentId: value })}
            options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.label }))]}
          />
        </label>
        {pending && <span className="acc-loading" role="status">กำลังโหลด…</span>}
      </div>

      {/* เปรียบเทียบ: ไม่เทียบ | เทียบกับช่วงก่อนหน้า (ระบบเลือกให้) | เลือกเองทั้งสองฝั่ง */}
      <div className="acc-filter-line acc-compare-line">
        <span className="acc-filter-label">เปรียบเทียบ</span>
        <div className="acc-compare-body">
          <nav className="acc-chips" aria-label="เปรียบเทียบ">
            <button type="button" aria-pressed={query.compare === "none"} onClick={() => go({ compare: "none" })}>ไม่เทียบ</button>
            {comparison && (
              <button type="button" aria-pressed={query.compare === "previous"} onClick={() => go({ compare: "previous" })}>{comparison.button}</button>
            )}
            <button type="button" aria-pressed={query.compare === "custom"} onClick={() => go({ compare: "custom" })}>เลือกเอง</button>
          </nav>
          {query.compare === "custom" ? (
            <>
              <div className="acc-custom-compare">
                {/* เลือกหน่วยก่อน A กับ B จะเป็นหน่วยเดียวกันเสมอ (วันเทียบวัน งวดเทียบงวด) */}
                <div className="acc-unit-line">
                  <span className="acc-span-label">เทียบทีละ</span>
                  <nav className="acc-chips" aria-label="หน่วยของการเปรียบเทียบ">
                    {COMPARE_UNITS.map((unit) => (
                      <button
                        key={unit}
                        type="button"
                        aria-pressed={query.compareUnit === unit}
                        onClick={() => {
                          if (unit === query.compareUnit) return;
                          const defaults = defaultCompareValues(unit);
                          go({ compareUnit: unit, compareA: defaults.a, compareB: defaults.b });
                        }}
                      >
                        {COMPARE_UNIT_LABEL[unit]}
                      </button>
                    ))}
                  </nav>
                </div>
                <div className="acc-ab-line">
                  <ComparePicker
                    label="ช่วง A"
                    unit={query.compareUnit}
                    value={query.compareUnit === "draw" ? drawA : query.compareA}
                    options={query.compareUnit === "day" ? days : query.compareUnit === "week" ? weeks : query.compareUnit === "month" ? months : draws}
                    onChange={(value) => {
                      if (query.compareUnit !== "draw") return go({ compareA: value });
                      // เปลี่ยนงวด A เป็นคนละประเภทหวยกับ B: ปล่อย B ว่างให้ระบบเลือกงวดก่อนหน้าของประเภทเดียวกับ A
                      const lotteryOf = (id: string) => draws.find((draw) => draw.value === id)?.lotteryType;
                      go({ compareA: value, compareB: lotteryOf(value) === lotteryOf(drawB) ? drawB : "" });
                    }}
                  />
                  <b className="acc-custom-vs">เทียบกับ</b>
                  <ComparePicker
                    label="ช่วง B"
                    unit={query.compareUnit}
                    value={query.compareUnit === "draw" ? drawB : query.compareB}
                    options={query.compareUnit === "day" ? days : query.compareUnit === "week" ? weeks : query.compareUnit === "month" ? months : draws}
                    onChange={(value) => go({ compareB: value, ...(query.compareUnit === "draw" ? { compareA: drawA } : {}) })}
                  />
                </div>
              </div>
              <p className="acc-compare-hint">
                {query.compareUnit === "draw"
                  ? "เทียบทั้งงวด (ทุก Agent ตามตัวกรองด้านบน) · เลือกงวดของประเภทหวยเดียวกันจะเทียบได้ตรงที่สุด"
                  : `เทียบทีละ${COMPARE_UNIT_LABEL[query.compareUnit]} · ใช้ประเภทหวยและ Agent เดียวกับด้านบน`} · ผลอยู่ใต้ตัวเลขกำไร
              </p>
            </>
          ) : (
            <p className="acc-compare-hint">
              {query.compare === "previous" && comparison ? (
                <>กำลังเทียบ <b>{comparison.current}</b> กับ <b>{comparison.previous}</b> · ผลอยู่ใต้ตัวเลขกำไรด้านล่าง</>
              ) : comparison ? (
                <>กด &ldquo;{comparison.button}&rdquo; ให้ระบบเลือกช่วงให้ หรือกด &ldquo;เลือกเอง&rdquo; เช่น มกราคม เทียบกับ มีนาคม</>
              ) : (
                <>กด &ldquo;เลือกเอง&rdquo; เพื่อเลือกสองช่วงที่ต้องการเทียบ เช่น มกราคม เทียบกับ มีนาคม</>
              )}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

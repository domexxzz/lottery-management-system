"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
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

const LOTTERIES = [
  { value: "THAI_GOVERNMENT", label: "หวยรัฐบาล" },
  { value: "LAO", label: "หวยลาว" },
  { value: "LAO_SET", label: "หวยลาวชุด" },
] as const;

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
  const allSelected = query.lotteries.length === ACCOUNTING_LOTTERIES.length;
  const customMode = query.compare === "custom";
  const otherActive = OTHER_PERIODS.includes(query.period as (typeof OTHER_PERIODS)[number]);

  /**
   * เลือกได้หลายประเภท เช่น หวยรัฐบาล + หวยลาว (ไม่รวมลาวชุด)
   * - จาก "ทุกประเภท" แตะประเภทไหน = ดูเฉพาะประเภทนั้น (ไม่ใช่เอาประเภทนั้นออก)
   * - จากนั้นแตะเพิ่ม/เอาออกทีละประเภท
   * - เอาออกจนไม่เหลือ หรือเลือกครบทุกประเภท = กลับไปทุกประเภท
   */
  const toggleLottery = (lottery: AccountingLottery) => {
    if (allSelected) return go({ lotteries: [lottery] });
    const selected = query.lotteries.includes(lottery);
    const next = selected
      ? query.lotteries.filter((value) => value !== lottery)
      : ACCOUNTING_LOTTERIES.filter((value) => query.lotteries.includes(value) || value === lottery);
    go({ lotteries: next.length === 0 ? [...ACCOUNTING_LOTTERIES] : next });
  };

  return (
    <section className={`acc-filters ${pending ? "is-loading" : ""}`} aria-label="เลือกช่วงเวลาและตัวกรอง" aria-busy={pending}>
      <div className={`acc-filter-line ${customMode ? "is-muted" : ""}`}>
        <span className="acc-filter-label">ช่วงเวลา</span>
        <nav className="acc-chips" aria-label="ช่วงเวลา">
          {ACCOUNTING_MAIN_PERIODS.map((period) => (
            <button key={period} type="button" aria-pressed={!customMode && query.period === period} onClick={() => go({ period, compare: customMode ? "none" : query.compare })}>{periodLabel(period)}</button>
          ))}
          <span className={`acc-more-period ${otherActive ? "is-active" : ""}`}>
            <AppDropdown
              ariaLabel="ช่วงเวลาอื่น"
              value={otherActive && !customMode ? query.period : ""}
              onValueChange={(value) => { if (value) go({ period: value as AccountingPeriodKind, compare: customMode ? "none" : query.compare }); }}
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
          <label>ตั้งแต่<input type="date" value={query.from} onChange={(event) => go({ from: event.target.value })} /></label>
          <label>ถึง<input type="date" value={query.to} onChange={(event) => go({ to: event.target.value })} /></label>
        </div>
      )}

      <div className="acc-filter-line">
        <span className="acc-filter-label">ประเภทหวย</span>
        <nav className="acc-chips acc-lottery-chips" aria-label="ประเภทหวย (เลือกได้หลายประเภท)">
          <button type="button" aria-pressed={allSelected} onClick={() => go({ lotteries: [...ACCOUNTING_LOTTERIES] })}>ทุกประเภท</button>
          {LOTTERIES.map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={!allSelected && query.lotteries.includes(item.value)}
              onClick={() => toggleLottery(item.value)}
            >
              <span className="acc-check" aria-hidden="true">{!allSelected && query.lotteries.includes(item.value) ? "✓" : ""}</span>
              <LotteryFlag lotteryType={item.value} />
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      <p className="acc-lottery-hint">
        {allSelected
          ? "แตะประเภทเพื่อดูเฉพาะประเภทนั้น แล้วแตะเพิ่มได้หลายประเภท เช่น หวยรัฐบาล + หวยลาว"
          : `กำลังดู: ${LOTTERIES.filter((item) => query.lotteries.includes(item.value)).map((item) => item.label).join(" + ")} · แตะเพื่อเพิ่มหรือเอาออก`}
      </p>

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

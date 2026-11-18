"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../../AppDropdown";
import { LotteryFlag } from "../../bills/ThaiFlag";
import { ACCOUNTING_LOTTERIES, ACCOUNTING_PERIOD_LABELS, ACCOUNTING_QUICK_PERIODS, accountingHref, type AccountingLottery, type AccountingPeriodKind, type AccountingQuery, type AccountingQuickPeriod } from "@/lib/reports/accounting-period";

const PERIOD_ROWS: { label: string; periods: AccountingPeriodKind[] }[] = [
  { label: "ทั้งหมด", periods: ["all"] },
  { label: "รายวัน", periods: ["today", "yesterday", "this_week", "last_week"] },
  { label: "รายงวด", periods: ["current_draw", "previous_draw"] },
  { label: "รายเดือน", periods: ["current_month", "3m", "6m"] },
  { label: "รายปี", periods: ["current_year", "previous_year", "custom"] },
];

const COMPARE_OPTIONS = ACCOUNTING_QUICK_PERIODS.map((value) => ({ value, label: ACCOUNTING_PERIOD_LABELS[value] }));

const LOTTERIES = [
  { value: "THAI_GOVERNMENT", label: "หวยรัฐบาล" },
  { value: "LAO", label: "หวยลาว" },
  { value: "LAO_SET", label: "หวยลาวชุด" },
] as const;

/** ตัวกรองหน้าสรุปบัญชี: เลือกช่วงเวลา ประเภทหวย และ Agent แล้วหน้าเปลี่ยนทันที */
export function AccountingFilters({ query, agents }: {
  query: AccountingQuery;
  agents: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const go = (change: Partial<AccountingQuery>) => startTransition(() => router.replace(accountingHref(pathname, query, change), { scroll: false }));
  const allSelected = query.lotteries.length === ACCOUNTING_LOTTERIES.length;
  const toggleLottery = (lottery: AccountingLottery) => {
    const selected = query.lotteries.includes(lottery);
    const lotteries = selected
      ? query.lotteries.filter((value) => value !== lottery)
      : ACCOUNTING_LOTTERIES.filter((value) => query.lotteries.includes(value) || value === lottery);
    go({ lotteries });
  };

  return (
    <section className={`acc-filters ${pending ? "is-loading" : ""}`} aria-label="เลือกช่วงเวลาและตัวกรอง">
      <div className="acc-period-rows" aria-label="ช่วงเวลา">
        {PERIOD_ROWS.map((row) => (
          <div className="acc-period-row" key={row.label}>
            <strong>{row.label}</strong>
            <nav className="acc-tabs" aria-label={row.label}>
              {row.periods.map((period) => (
                <button key={period} type="button" aria-pressed={query.period === period} onClick={() => go({ period })}>{period === "custom" ? "กำหนดช่วงเอง" : ACCOUNTING_PERIOD_LABELS[period]}</button>
              ))}
            </nav>
          </div>
        ))}
      </div>

      <div className="acc-filter-row">
        {query.period === "custom" && (
          <>
            <label>ตั้งแต่<input type="date" value={query.from} onChange={(event) => go({ from: event.target.value })} /></label>
            <label>ถึง<input type="date" value={query.to} onChange={(event) => go({ to: event.target.value })} /></label>
          </>
        )}
        <label>Agent
          <AppDropdown
            searchable={agents.length > 8}
            value={query.agentId}
            onValueChange={(value) => go({ agentId: value })}
            options={[{ value: "", label: "ทุก Agent" }, ...agents.map((agent) => ({ value: agent.id, label: agent.label }))]}
          />
        </label>
        <div className="acc-compare-picker" aria-label="เลือกช่วงที่ต้องการเปรียบเทียบ">
          <span>เปรียบเทียบ</span>
          <label>ช่วง A<AppDropdown value={query.compareA} onValueChange={(value) => go({ compareA: value as AccountingQuickPeriod })} options={COMPARE_OPTIONS} /></label>
          <b>กับ</b>
          <label>ช่วง B<AppDropdown value={query.compareB} onValueChange={(value) => go({ compareB: value as AccountingQuickPeriod })} options={COMPARE_OPTIONS} /></label>
        </div>
      </div>

      <nav className="acc-lottery" aria-label="ประเภทหวย">
        <button type="button" aria-pressed={allSelected} onClick={() => go({ lotteries: [...ACCOUNTING_LOTTERIES] })}>
          ทุกประเภท
        </button>
        {LOTTERIES.map((item) => (
          <button key={item.value} type="button" aria-pressed={query.lotteries.includes(item.value)} onClick={() => toggleLottery(item.value)}>
            <LotteryFlag lotteryType={item.value} />
            {item.label}
          </button>
        ))}
      </nav>
    </section>
  );
}

"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../../AppDropdown";
import { LotteryFlag } from "../../bills/ThaiFlag";
import { accountingHref, type AccountingPeriodKind, type AccountingQuery } from "@/lib/reports/accounting-period";

const PERIODS: { value: AccountingPeriodKind; label: string }[] = [
  { value: "draw", label: "รายงวด" },
  { value: "month", label: "รายเดือน" },
  { value: "3m", label: "3 เดือน" },
  { value: "6m", label: "6 เดือน" },
  { value: "year", label: "รายปี" },
  { value: "custom", label: "กำหนดเอง" },
];

const LOTTERIES = [
  { value: "", label: "ทุกประเภท" },
  { value: "THAI_GOVERNMENT", label: "หวยรัฐบาล" },
  { value: "LAO", label: "หวยลาว" },
  { value: "LAO_SET", label: "หวยลาวชุด" },
] as const;

/** ตัวกรองหน้าสรุปบัญชี: เลือกช่วงเวลา ประเภทหวย และ Agent แล้วหน้าเปลี่ยนทันที */
export function AccountingFilters({ query, draws, agents, months, years }: {
  query: AccountingQuery;
  draws: { id: string; label: string; lotteryType: string }[];
  agents: { id: string; label: string }[];
  months: { value: string; label: string }[];
  years: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const go = (change: Partial<AccountingQuery>) => startTransition(() => router.replace(accountingHref(pathname, query, change), { scroll: false }));

  return (
    <section className={`acc-filters ${pending ? "is-loading" : ""}`} aria-label="เลือกช่วงเวลาและตัวกรอง">
      <nav className="acc-tabs" aria-label="ช่วงเวลา">
        {PERIODS.map((period) => (
          <button key={period.value} type="button" aria-pressed={query.period === period.value} onClick={() => go({ period: period.value })}>{period.label}</button>
        ))}
      </nav>

      <div className="acc-filter-row">
        {query.period === "draw" && (
          <label>งวด
            <AppDropdown
              searchable
              value={query.drawId}
              placeholder="เลือกงวด"
              searchPlaceholder="ค้นหางวด"
              onValueChange={(value) => go({ drawId: value })}
              options={draws.map((draw) => ({ value: draw.id, label: draw.label, lotteryType: draw.lotteryType }))}
            />
          </label>
        )}
        {query.period === "month" && (
          <label>เดือน
            <AppDropdown value={query.month} onValueChange={(value) => go({ month: value })} options={months} />
          </label>
        )}
        {query.period === "year" && (
          <label>ปี
            <AppDropdown value={query.year} onValueChange={(value) => go({ year: value })} options={years.map((year) => ({ value: year, label: `พ.ศ. ${Number(year) + 543}` }))} />
          </label>
        )}
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
      </div>

      <nav className="acc-lottery" aria-label="ประเภทหวย">
        {LOTTERIES.map((item) => (
          <button key={item.value} type="button" aria-pressed={query.lottery === item.value} onClick={() => go({ lottery: item.value, drawId: "" })}>
            {item.value && <LotteryFlag lotteryType={item.value} />}
            {item.label}
          </button>
        ))}
      </nav>
    </section>
  );
}

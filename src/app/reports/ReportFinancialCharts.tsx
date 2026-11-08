"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";

export type ReportFinancialChartRow = {
  id: string;
  label: string;
  name: string;
  gross: number;
  payout: number;
  net: number;
};

type Metric = "gross" | "payout" | "net";
type Range = 6 | 12 | "all";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });
const METRICS: Array<{ key: Metric; label: string; icon: string; tone: string; description: string }> = [
  { key: "gross", label: "ยอดรับแทง", icon: "▣", tone: "gross", description: "ยอดรับแทงของแต่ละงวด" },
  { key: "payout", label: "จ่ายรางวัล", icon: "♛", tone: "payout", description: "ยอดเงินรางวัลที่จ่ายจริง" },
  { key: "net", label: "ยอดสุทธิ", icon: "⚖", tone: "net", description: "ค่าบวกและค่าลบเทียบเส้นศูนย์" },
];

function ChartCard({
  metric,
  rows,
  selected,
  onSelect,
}: {
  metric: (typeof METRICS)[number];
  rows: ReportFinancialChartRow[];
  selected?: { metric: Metric; id: string };
  onSelect: (metric: Metric, id: string) => void;
}) {
  const maximum = Math.max(...rows.map((row) => Math.abs(row[metric.key])), 1);
  const chosen = selected?.metric === metric.key ? rows.find((row) => row.id === selected.id) : undefined;

  return (
    <article className={`report-financial-chart report-financial-chart--${metric.tone}`}>
      <header>
        <span className="report-financial-chart-icon" aria-hidden="true">{metric.icon}</span>
        <div><strong>{metric.label}</strong><small>{metric.description}</small></div>
        <em>สูงสุด {COMPACT.format(maximum)} บาท</em>
      </header>
      <div className={`report-financial-plot ${metric.key === "net" ? "is-net" : ""}`} role="list" aria-label={`กราฟ${metric.label} แยกตามงวด`}>
        {rows.map((row) => {
          const value = row[metric.key];
          const size = Math.max(Math.abs(value) / maximum * (metric.key === "net" ? 46 : 100), 2);
          const style = metric.key === "net"
            ? ({ "--bar-size": `${size}%` } as CSSProperties)
            : { height: `${size}%` };
          return (
            <button
              type="button"
              role="listitem"
              key={row.id}
              className={`${value < 0 ? "negative" : "positive"} ${selected?.metric === metric.key && selected.id === row.id ? "selected" : ""}`}
              aria-label={`${row.name} ${metric.label} ${MONEY.format(value)} บาท`}
              title={`${row.name}: ${MONEY.format(value)} บาท`}
              onClick={() => onSelect(metric.key, row.id)}
            >
              <span className="report-financial-bar-stage"><i style={style} /></span>
              <small>{row.label}</small>
            </button>
          );
        })}
      </div>
      <footer>
        {chosen ? <><span>{chosen.name}</span><strong className={chosen[metric.key] < 0 ? "negative" : undefined}>{MONEY.format(chosen[metric.key])}&nbsp;บาท</strong></> : <><span>คลิกแท่งกราฟเพื่อดูตัวเลข</span><strong>สเกลเฉพาะชุด</strong></>}
      </footer>
    </article>
  );
}

export function ReportFinancialCharts({ id, rows }: { id?: string; rows: ReportFinancialChartRow[] }) {
  const [range, setRange] = useState<Range>(12);
  const [selected, setSelected] = useState<{ metric: Metric; id: string }>();
  const visibleRows = useMemo(() => range === "all" ? rows : rows.slice(-range), [range, rows]);

  return (
    <section id={id} className="report-panel report-financial-section" aria-labelledby="financial-trends-heading">
      <div className="report-financial-heading">
        <div><span className="report-section-icon" aria-hidden="true">▥</span><span><span className="report-kicker">FINANCIAL PERFORMANCE</span><h2 id="financial-trends-heading">เงินเข้า–ออก แยกตามงวด</h2><p>แยกสเกลตามตัวชี้วัดเพื่อให้เห็นแนวโน้ม โดยไม่เปรียบเทียบความสูงข้ามกราฟ</p></span></div>
        <div className="report-range-tabs" role="group" aria-label="เลือกจำนวนงวดที่แสดง">
          {([{ value: 6, label: "6 งวด" }, { value: 12, label: "12 งวด" }, { value: "all", label: "ทั้งหมด" }] as const).map((option) => <button type="button" key={option.label} className={range === option.value ? "active" : undefined} aria-pressed={range === option.value} onClick={() => setRange(option.value)}>{option.label}</button>)}
        </div>
      </div>
      {visibleRows.length === 0 ? <div className="report-empty">ยังไม่มีข้อมูลรายงวดสำหรับสร้างกราฟ</div> : <div className="report-financial-grid">{METRICS.map((metric) => <ChartCard key={metric.key} metric={metric} rows={visibleRows} selected={selected} onSelect={(selectedMetric, selectedId) => setSelected({ metric: selectedMetric, id: selectedId })} />)}</div>}
    </section>
  );
}

"use client";

import { useState } from "react";

type Metric = "gross" | "payout" | "net" | "bills";
type ChartRow = {
  code: string;
  name: string;
  gross: number;
  payout: number;
  net: number;
  bills: number;
};

const METRICS: Array<{ key: Metric; label: string; money: boolean }> = [
  { key: "gross", label: "ยอดขาย", money: true },
  { key: "payout", label: "จ่ายรางวัล", money: true },
  { key: "net", label: "สุทธิ", money: true },
  { key: "bills", label: "จำนวนบิล", money: false },
];

const money = new Intl.NumberFormat("th-TH", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function ReportChart({ rows }: { rows: ChartRow[] }) {
  const [metric, setMetric] = useState<Metric>("gross");
  const config = METRICS.find((item) => item.key === metric)!;
  const ranked = [...rows].sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric])).slice(0, 7);
  const maximum = Math.max(...ranked.map((row) => Math.abs(row[metric])), 1);

  return (
    <section className="report-panel report-chart-panel" aria-labelledby="performance-chart-heading">
      <div className="report-panel-heading">
        <div>
          <span className="report-kicker">PERFORMANCE</span>
          <h2 id="performance-chart-heading">ภาพรวมผลงาน Agent</h2>
          <p>เปลี่ยนมุมมองกราฟเพื่อหาจุดที่ควรสนใจได้ทันที</p>
        </div>
        <div className="report-metric-tabs" role="group" aria-label="เลือกข้อมูลในกราฟ">
          {METRICS.map((item) => (
            <button
              type="button"
              key={item.key}
              className={metric === item.key ? "active" : undefined}
              aria-pressed={metric === item.key}
              onClick={() => setMetric(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {ranked.length === 0 ? (
        <div className="report-empty">ยังไม่มีข้อมูลสำหรับสร้างกราฟ</div>
      ) : (
        <div className="report-bars">
          {ranked.map((row, index) => {
            const value = row[metric];
            return (
              <div className="report-bar-row" key={row.code}>
                <span className="report-rank">{index + 1}</span>
                <span className="report-bar-name"><b>{row.code}</b><small>{row.name}</small></span>
                <span className="report-bar-track" aria-hidden="true">
                  <i className={value < 0 ? "negative" : undefined} style={{ width: `${Math.max((Math.abs(value) / maximum) * 100, 2)}%` }} />
                </span>
                <strong className={value < 0 ? "negative" : undefined}>
                  {config.money ? money.format(value) : value.toLocaleString("th-TH")}
                  <small>{config.money ? " บาท" : " บิล"}</small>
                </strong>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

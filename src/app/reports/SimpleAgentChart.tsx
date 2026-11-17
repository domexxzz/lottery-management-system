"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { AppDropdown } from "../AppDropdown";

type ChartType = "bar" | "line" | "donut";
type Row = { id: string; period: string; name: string; gross: number; commission: number };

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TYPES: Array<{ value: ChartType; label: string; icon: string }> = [
  { value: "bar", label: "กราฟแท่ง", icon: "▥" },
  { value: "line", label: "กราฟเส้น", icon: "⌁" },
  { value: "donut", label: "กราฟโดนัท", icon: "◉" },
];

export function SimpleAgentDrawPicker({ options, value, latestName }: { options: Array<{ id: string; name: string }>; value: string; latestName: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function select(drawId: string) {
    startTransition(() => router.replace(drawId ? `/reports?draw=${encodeURIComponent(drawId)}` : "/reports", { scroll: false }));
  }

  return <section className={`agent-simple-picker ${pending ? "is-loading" : ""}`}>
    <div><span>เลือกงวดที่ต้องการดู</span><strong>ระบบจะเปรียบเทียบกับงวดก่อนหน้าให้อัตโนมัติ</strong></div>
    <label><span>งวด</span><AppDropdown value={value} onValueChange={select} searchable={options.length > 8} searchPlaceholder="ค้นหาชื่องวด" options={[{ value: "", label: latestName ? `งวดล่าสุด · ${latestName}` : "งวดล่าสุด" }, ...options.map((draw) => ({ value: draw.id, label: draw.name }))]} /></label>
    {pending && <small>กำลังเปลี่ยนงวด…</small>}
  </section>;
}

export function SimpleAgentChart({ rows }: { rows: Row[] }) {
  const [type, setType] = useState<ChartType>("bar");
  const maximum = Math.max(...rows.flatMap((row) => [row.gross, row.commission]), 1);
  const totalSales = rows.reduce((sum, row) => sum + row.gross, 0);
  const firstShare = totalSales > 0 ? rows[0]!.gross / totalSales * 100 : 0;
  const xAt = (index: number) => rows.length === 1 ? 300 : 115 + index * 370;
  const yAt = (value: number) => 225 - value / maximum * 170;

  return <section className="agent-simple-chart">
    <header><div><p className="page-eyebrow">SALES COMPARISON</p><h2>ยอดขาย 2 งวดล่าสุด</h2><p>สีน้ำเงินคือยอดขาย สีม่วงคือค่าคอม</p></div><div className="agent-simple-chart-types">{TYPES.map((item) => <button key={item.value} type="button" className={type === item.value ? "active" : undefined} aria-pressed={type === item.value} onClick={() => setType(item.value)}><span>{item.icon}</span>{item.label}</button>)}</div></header>

    {type === "bar" && <div className="agent-simple-bars">{rows.map((row) => <article key={row.id}>
      <header><span>{row.period}</span><strong>{row.name}</strong></header>
      <div className="agent-simple-bar-stage"><i style={{ height: `${Math.max(row.gross / maximum * 100, row.gross ? 3 : 0)}%` }}><b>{MONEY.format(row.gross)}</b></i><i className="commission" style={{ height: `${Math.max(row.commission / maximum * 100, row.commission ? 3 : 0)}%` }}><b>{MONEY.format(row.commission)}</b></i></div>
      <footer><span><i />ยอดขาย</span><span><i />ค่าคอม</span></footer>
    </article>)}</div>}

    {type === "line" && <div className="agent-simple-line"><svg viewBox="0 0 600 285" role="img" aria-label="กราฟเส้นยอดขายและค่าคอมสองงวดล่าสุด">
      {[0, 1, 2, 3, 4].map((step) => <g key={step}><line x1="55" x2="545" y1={55 + step * 42.5} y2={55 + step * 42.5} /><text x="48" y={59 + step * 42.5}>{MONEY.format(maximum * (4 - step) / 4)}</text></g>)}
      {(["gross", "commission"] as const).map((metric) => { const points = rows.map((row, index) => `${xAt(index)},${yAt(row[metric])}`).join(" "); return <g key={metric} className={metric}><polyline points={points} />{rows.map((row, index) => <g key={row.id}><circle cx={xAt(index)} cy={yAt(row[metric])} r="6" /><text className="value" x={xAt(index)} y={yAt(row[metric]) - 12}>{MONEY.format(row[metric])}</text></g>)}</g>; })}
      {rows.map((row, index) => <text key={row.id} className="label" x={xAt(index)} y="265">{row.period}</text>)}
    </svg><div className="agent-simple-chart-legend"><span><i />ยอดขาย</span><span><i />ค่าคอม</span></div></div>}

    {type === "donut" && <div className="agent-simple-donut-layout">
      <div className={`agent-simple-donut ${totalSales === 0 ? "is-empty" : ""}`} style={{ background: totalSales === 0 ? undefined : `conic-gradient(#1677e8 0 ${firstShare}%, #68c6bd ${firstShare}% 100%)` }}><div><strong>{MONEY.format(totalSales)}</strong><span>ยอดขายรวม 2 งวด</span></div></div>
      <div className="agent-simple-donut-legend">{rows.map((row, index) => <article key={row.id}><i className={`tone-${index}`} /><div><span>{row.period}</span><strong>{row.name}</strong><small>ยอดขาย {MONEY.format(row.gross)} บาท · ค่าคอม {MONEY.format(row.commission)} บาท</small></div><b>{totalSales ? (row.gross / totalSales * 100).toFixed(1) : "0.0"}%</b></article>)}</div>
    </div>}
  </section>;
}

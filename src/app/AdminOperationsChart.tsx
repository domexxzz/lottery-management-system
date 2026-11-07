"use client";

import { useState } from "react";
import { ChartTabs } from "./ChartTabs";

type DailyPoint = { label: string; bills: number; sales: number; reviewed: number };
type Backlog = { evidence: number; settlement: number; cancellation: number; rejected: number };
type View = "bills" | "reviews" | "backlog";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TABS = [
  { id: "bills", label: "ยอดบิล", icon: "bill" },
  { id: "reviews", label: "งานตรวจ", icon: "audit" },
  { id: "backlog", label: "งานค้าง", icon: "alert" },
] as const;

export function AdminOperationsChart({ daily, backlog }: { daily: DailyPoint[]; backlog: Backlog }) {
  const [view, setView] = useState<View>("bills");
  const maxSales = Math.max(...daily.map((row) => row.sales), 1);
  const maxReviewed = Math.max(...daily.map((row) => row.reviewed), 1);
  const points = daily.map((row, index) => ({ x: 24 + index * 109, y: 154 - row.sales / maxSales * 116, ...row }));
  const line = points.map((point) => `${point.x},${point.y}`).join(" ");
  const backlogRows = [
    { label: "หลักฐานรอตรวจ", value: backlog.evidence, color: "#15949b" },
    { label: "รอตรวจสอบยอด", value: backlog.settlement, color: "#efad3b" },
    { label: "คำขอยกเลิก", value: backlog.cancellation, color: "#7566b1" },
    { label: "หลักฐานตีกลับ", value: backlog.rejected, color: "#d8545b" },
  ];
  const backlogTotal = backlogRows.reduce((sum, row) => sum + row.value, 0);
  let degree = 0;
  const gradient = backlogRows.map((row) => {
    const start = degree;
    degree += backlogTotal ? row.value / backlogTotal * 360 : 0;
    return `${row.color} ${start}deg ${degree}deg`;
  }).join(", ");

  return <article className="dashboard-panel admin-chart-panel">
    <div className="panel-heading admin-chart-heading">
      <div><p className="eyebrow">Operations Trend</p><h2>กราฟภาพรวมการทำงาน</h2></div>
      <ChartTabs panelId="admin-chart" options={TABS} selected={view} onSelect={setView} />
    </div>

    <div id="admin-chart" role="tabpanel" aria-labelledby={`admin-chart-${view}`} tabIndex={0}>
    {view === "bills" && <div className="admin-line-chart" role="img" aria-label="กราฟยอดบิลย้อนหลัง 7 วัน"><div className="admin-chart-total"><strong>{MONEY.format(daily.reduce((sum, row) => sum + row.sales, 0))}</strong><span>บาท · {daily.reduce((sum, row) => sum + row.bills, 0)} บิลใน 7 วัน</span></div><svg viewBox="0 0 700 175" preserveAspectRatio="none" aria-hidden="true">{[38,77,116,154].map((y) => <line key={y} x1="20" x2="680" y1={y} y2={y}/>) }<polyline points={line}/>{points.map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="4" />)}</svg><div className="admin-chart-labels">{daily.map((row) => <span key={row.label}>{row.label}</span>)}</div></div>}

    {view === "reviews" && <div className="admin-review-chart" role="img" aria-label="กราฟจำนวนหลักฐานที่ตรวจย้อนหลัง 7 วัน"><div className="admin-chart-total"><strong>{daily.reduce((sum, row) => sum + row.reviewed, 0)}</strong><span>หลักฐานที่ตรวจใน 7 วัน</span></div><div>{daily.map((row) => <article key={row.label}><b>{row.reviewed || ""}</b><span><i style={{ height: `${row.reviewed ? Math.max(row.reviewed / maxReviewed * 100, 8) : 0}%` }}/></span><small>{row.label}</small></article>)}</div></div>}

    {view === "backlog" && <div className="admin-donut-layout"><div className="admin-donut" style={{ background: backlogTotal ? `conic-gradient(${gradient})` : "#e8eef1" }} role="img" aria-label={`งานค้างทั้งหมด ${backlogTotal} รายการ`}><div><strong>{backlogTotal}</strong><span>งานค้าง</span></div></div><div className="admin-donut-legend">{backlogRows.map((row) => <p key={row.label}><i style={{ background: row.color }}/><span>{row.label}</span><strong>{row.value}</strong></p>)}</div></div>}
    </div>
  </article>;
}

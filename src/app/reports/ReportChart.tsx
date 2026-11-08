"use client";

import { useEffect, useMemo, useState } from "react";
import { AppDropdown } from "../AppDropdown";

export type ReportMetric = "gross" | "payout" | "commission" | "net" | "bills" | "items" | "winners";
export type ReportChartDatum = {
  id: string;
  code: string;
  name: string;
  href?: string;
  gross: number;
  payout: number;
  commission: number;
  net: number;
  bills: number;
  items: number;
  winners: number;
};
export type ReportChartDataset = {
  key: string;
  label: string;
  description: string;
  rows: ReportChartDatum[];
  metrics?: ReportMetric[];
};
export type ReportChartVariant = "business" | "customer-behavior";

type AnalysisMode = "business" | "engineer";
type ChartType = "bar" | "line" | "donut" | "table" | "comparison" | "scatter" | "distribution";
type MetricCopy = Partial<Record<ReportMetric, { label: string; description: string }>>;

const METRICS: Array<{ key: ReportMetric; label: string; description: string; money: boolean; color: string }> = [
  { key: "gross", label: "ยอดขาย", description: "ยอดรับแทงรวม", money: true, color: "#1677ff" },
  { key: "payout", label: "จ่ายรางวัล", description: "เงินรางวัลที่จ่าย", money: true, color: "#f0a31a" },
  { key: "commission", label: "คอมมิชชัน", description: "ค่านายหน้าตัวแทน", money: true, color: "#7657d5" },
  { key: "net", label: "ยอดสุทธิ", description: "หลังหักรางวัลและคอมมิชชัน", money: true, color: "#16a477" },
  { key: "bills", label: "จำนวนบิล", description: "จำนวนบิลทั้งหมด", money: false, color: "#168ca0" },
  { key: "items", label: "จำนวนรายการ", description: "จำนวนเลขที่รับแทง", money: false, color: "#4184bc" },
  { key: "winners", label: "ถูกรางวัล", description: "จำนวนรายการที่ถูกรางวัล", money: false, color: "#db5b65" },
];

const CUSTOMER_BEHAVIOR_METRICS: MetricCopy = {
  gross: { label: "ยอดซื้อ", description: "มูลค่าที่ลูกค้าซื้อรวม" },
  bills: { label: "ความถี่ซื้อ", description: "จำนวนครั้งที่ลูกค้าซื้อ" },
  items: { label: "จำนวนเลขที่เลือก", description: "จำนวนรายการเลขที่ลูกค้าเลือก" },
  winners: { label: "รายการถูกรางวัล", description: "จำนวนรายการของลูกค้าที่ถูกรางวัล" },
};

const BUSINESS_CHARTS = [
  { value: "bar", label: "กราฟแท่ง", description: "เปรียบเทียบขนาดและอันดับได้ง่าย" },
  { value: "line", label: "กราฟแนวโน้ม", description: "ดูการเปลี่ยนแปลงตามลำดับข้อมูล" },
  { value: "donut", label: "กราฟสัดส่วน", description: "ดูส่วนแบ่งของตัวชี้วัดหลัก" },
  { value: "table", label: "ตารางเปรียบเทียบ", description: "ดูตัวเลขจริงทุกค่า" },
];
const ENGINEER_CHARTS = [
  { value: "comparison", label: "Standardized Comparison", description: "เทียบหลายค่าด้วย Z-score" },
  { value: "scatter", label: "Correlation & Regression", description: "วิเคราะห์ความสัมพันธ์สองตัวแปร" },
  { value: "distribution", label: "Distribution Statistics", description: "Median, Quartile, SD และ CV" },
  { value: "table", label: "Statistical Data Table", description: "ตรวจข้อมูลดิบแบบละเอียด" },
];

const NUMBER = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });
const ALL_METRICS = METRICS.map((metric) => metric.key);

function configOf(metric: ReportMetric, copy?: MetricCopy) {
  const base = METRICS.find((item) => item.key === metric)!;
  return copy?.[metric] ? { ...base, ...copy[metric] } : base;
}

function formatted(value: number, metric: ReportMetric) {
  return configOf(metric).money ? `${MONEY.format(value)} บาท` : NUMBER.format(value);
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function quantile(sorted: number[], percentile: number) {
  if (!sorted.length) return 0;
  const position = (sorted.length - 1) * percentile;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower]! + (sorted[lower + 1] !== undefined ? fraction * (sorted[lower + 1]! - sorted[lower]!) : 0);
}

export function statistics(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const average = mean(sorted);
  const variance = sorted.length > 1
    ? sorted.reduce((sum, value) => sum + (value - average) ** 2, 0) / (sorted.length - 1)
    : 0;
  const deviation = Math.sqrt(variance);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    q1: quantile(sorted, .25),
    median: quantile(sorted, .5),
    q3: quantile(sorted, .75),
    max: sorted.at(-1) ?? 0,
    mean: average,
    deviation,
    cv: average === 0 ? 0 : Math.abs(deviation / average) * 100,
  };
}

export function correlation(x: number[], y: number[]) {
  if (x.length < 2 || x.length !== y.length) return { r: 0, slope: 0, intercept: 0 };
  const xMean = mean(x);
  const yMean = mean(y);
  const numerator = x.reduce((sum, value, index) => sum + (value - xMean) * (y[index]! - yMean), 0);
  const xSquare = x.reduce((sum, value) => sum + (value - xMean) ** 2, 0);
  const ySquare = y.reduce((sum, value) => sum + (value - yMean) ** 2, 0);
  const r = xSquare && ySquare ? numerator / Math.sqrt(xSquare * ySquare) : 0;
  const slope = xSquare ? numerator / xSquare : 0;
  return { r, slope, intercept: yMean - slope * xMean };
}

function relationshipLabel(r: number) {
  const strength = Math.abs(r);
  const word = strength >= .8 ? "สูงมาก" : strength >= .6 ? "สูง" : strength >= .4 ? "ปานกลาง" : strength >= .2 ? "ต่ำ" : "แทบไม่มี";
  return `${r >= 0 ? "ทิศทางเดียวกัน" : "สวนทางกัน"} · ${word}`;
}

function ComparisonChart({ rows, metrics, mode, type, selectedId, select, metricCopy }: {
  rows: ReportChartDatum[];
  metrics: ReportMetric[];
  mode: AnalysisMode;
  type: "bar" | "line" | "comparison";
  selectedId?: string;
  select: (row: ReportChartDatum) => void;
  metricCopy?: MetricCopy;
}) {
  const visible = rows.slice(-12);
  const transformed = new Map<ReportMetric, number[]>();
  for (const metric of metrics) {
    const values = visible.map((row) => row[metric]);
    if (mode === "engineer") {
      const stat = statistics(values);
      transformed.set(metric, values.map((value) => stat.deviation ? (value - stat.mean) / stat.deviation : 0));
    } else if (metrics.length > 1) {
      const maximum = Math.max(...values.map((value) => Math.abs(value)), 1);
      transformed.set(metric, values.map((value) => value / maximum * 100));
    } else {
      transformed.set(metric, values);
    }
  }
  const allValues = metrics.flatMap((metric) => transformed.get(metric) ?? []);
  const minimum = Math.min(0, ...allValues);
  const maximum = Math.max(0, ...allValues, 1);
  const range = Math.max(maximum - minimum, 1);
  const left = 58, right = 785, top = 28, bottom = 254;
  const zeroY = top + maximum / range * (bottom - top);
  const xAt = (index: number) => visible.length === 1 ? (left + right) / 2 : left + index / (visible.length - 1) * (right - left);
  const yAt = (value: number) => top + (maximum - value) / range * (bottom - top);
  const scaleLabel = mode === "engineer" ? "Z-score (จำนวนส่วนเบี่ยงเบนมาตรฐาน)" : metrics.length > 1 ? "ดัชนีเทียบค่าสูงสุดของแต่ละชุด = 100" : configOf(metrics[0]!, metricCopy).money ? "บาท" : "จำนวน";

  return <div className="advanced-comparison-chart">
    <div className="advanced-chart-legend"><span>{scaleLabel}</span>{metrics.map((metric) => <i key={metric}><u style={{ background: configOf(metric, metricCopy).color }} />{configOf(metric, metricCopy).label}</i>)}</div>
    <svg viewBox="0 0 840 305" role="img" aria-label={`กราฟเปรียบเทียบ ${metrics.map((metric) => configOf(metric, metricCopy).label).join(" และ ")}`}>
      {[0, 1, 2, 3, 4].map((step) => { const y = top + step / 4 * (bottom - top); const value = maximum - step / 4 * range; return <g key={step}><line className="advanced-gridline" x1={left} x2={right} y1={y} y2={y} /><text className="advanced-axis-label" x={left - 9} y={y + 4}>{mode === "engineer" ? value.toFixed(1) : COMPACT.format(value)}</text></g>; })}
      {minimum < 0 && <line className="advanced-zero-line" x1={left} x2={right} y1={zeroY} y2={zeroY} />}
      {type === "bar" ? visible.flatMap((row, rowIndex) => {
        const groupWidth = (right - left) / Math.max(visible.length, 1);
        const barWidth = Math.min(18, groupWidth / (metrics.length + 1));
        return metrics.map((metric, metricIndex) => {
          const value = transformed.get(metric)?.[rowIndex] ?? 0;
          const x = left + rowIndex * groupWidth + (groupWidth - barWidth * metrics.length) / 2 + metricIndex * barWidth;
          const y = Math.min(yAt(value), zeroY);
          return <rect key={`${row.id}-${metric}`} className={selectedId === row.id ? "selected" : undefined} x={x} y={y} width={Math.max(barWidth - 2, 2)} height={Math.max(Math.abs(zeroY - yAt(value)), 1)} rx="2" fill={configOf(metric, metricCopy).color} role="button" tabIndex={0} aria-label={`${row.name} · ${configOf(metric, metricCopy).label}: ${formatted(row[metric], metric)}`} onClick={() => select(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(row); }} />;
        });
      }) : metrics.map((metric) => {
        const points = visible.map((row, index) => ({ row, x: xAt(index), y: yAt(transformed.get(metric)?.[index] ?? 0) }));
        const path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
        return <g key={metric}><path className="advanced-series-line" d={path} style={{ stroke: configOf(metric, metricCopy).color }} />{points.map((point) => <circle key={point.row.id} className={selectedId === point.row.id ? "selected" : undefined} cx={point.x} cy={point.y} r={selectedId === point.row.id ? 6 : 4} fill="#fff" style={{ stroke: configOf(metric, metricCopy).color }} role="button" tabIndex={0} aria-label={`${point.row.name} · ${configOf(metric, metricCopy).label}: ${formatted(point.row[metric], metric)}`} onClick={() => select(point.row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(point.row); }} />)}</g>;
      })}
      {visible.map((row, index) => (visible.length <= 8 || index % 2 === 0 || index === visible.length - 1) && <text key={row.id} className="advanced-x-label" x={xAt(index)} y="283">{row.code.slice(0, 11)}</text>)}
    </svg>
  </div>;
}

function DonutChart({ rows, metric, selectedId, select, metricCopy }: { rows: ReportChartDatum[]; metric: ReportMetric; selectedId?: string; select: (row: ReportChartDatum) => void; metricCopy?: MetricCopy }) {
  const sorted = [...rows].sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric]));
  const visible = sorted.slice(0, 6);
  const remaining = sorted.slice(6);
  const total = sorted.reduce((sum, row) => sum + Math.abs(row[metric]), 0) || 1;
  const remainingValue = remaining.reduce((sum, row) => sum + Math.abs(row[metric]), 0);
  const slices = [
    ...visible.map((row) => ({ id: row.id, row, value: Math.abs(row[metric]), label: row.name })),
    ...(remainingValue > 0 ? [{ id: "other", row: undefined, value: remainingValue, label: `รายการอื่นอีก ${remaining.length} รายการ` }] : []),
  ];
  let offset = 0;
  return <div className="report-viz-donut-layout">
    <div className="report-viz-donut-summary">
      <div className="report-viz-donut">
        <svg viewBox="0 0 180 180" role="img" aria-label={`กราฟสัดส่วน${configOf(metric, metricCopy).label}`}>
          <circle className="donut-base" cx="90" cy="90" r="62" pathLength="100" />
          {slices.map((slice, index) => {
            const percent = slice.value / total * 100;
            const currentOffset = offset;
            offset += percent;
            const shared = {
              cx: 90,
              cy: 90,
              r: 62,
              pathLength: 100,
              stroke: METRICS[index % METRICS.length]!.color,
              strokeDasharray: `${percent} ${100 - percent}`,
              strokeDashoffset: -currentOffset,
            };
            return slice.row
              ? <circle {...shared} key={slice.id} className={selectedId === slice.id ? "selected" : undefined} role="button" tabIndex={0} aria-label={`${slice.label}: ${percent.toFixed(1)}%`} onClick={() => select(slice.row!)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(slice.row!); }} />
              : <circle {...shared} key={slice.id} className="is-other" aria-label={`${slice.label}: ${percent.toFixed(1)}%`} />;
          })}
        </svg>
        <div><strong>{COMPACT.format(total)}</strong><span>{configOf(metric, metricCopy).label}</span><small>{rows.length} รายการ</small></div>
      </div>
      <p>วงกลมแสดงสัดส่วนจากข้อมูลทั้งหมด ไม่ได้คำนวณเฉพาะรายการที่เห็น</p>
    </div>
    <div className="report-viz-share-panel">
      <header><div><strong>สัดส่วนสูงสุด</strong><small>เรียงจากมากไปน้อย</small></div><span>มูลค่า / สัดส่วน</span></header>
      <div className="report-viz-share-list">
        {visible.map((row, index) => {
          const percent = Math.abs(row[metric]) / total * 100;
          return <button type="button" key={row.id} className={`report-viz-share-item ${selectedId === row.id ? "selected" : ""}`} onClick={() => select(row)}>
            <i className="report-viz-share-dot" style={{ background: METRICS[index % METRICS.length]!.color }} />
            <span className="report-viz-share-name"><b>{row.code}</b><small>{row.name}</small></span>
            <span className="report-viz-share-value"><strong>{formatted(row[metric], metric)}</strong><small>{percent.toFixed(1)}%</small></span>
            <span className="report-viz-share-track" aria-hidden="true"><i style={{ width: `${Math.max(percent, 1)}%`, background: METRICS[index % METRICS.length]!.color }} /></span>
          </button>;
        })}
        {remainingValue > 0 && <div className="report-viz-share-item is-other">
          <i className="report-viz-share-dot" style={{ background: METRICS[visible.length % METRICS.length]!.color }} />
          <span className="report-viz-share-name"><b>รายการอื่นๆ</b><small>รวมอีก {remaining.length} รายการ</small></span>
          <span className="report-viz-share-value"><strong>{formatted(remainingValue, metric)}</strong><small>{(remainingValue / total * 100).toFixed(1)}%</small></span>
          <span className="report-viz-share-track" aria-hidden="true"><i style={{ width: `${remainingValue / total * 100}%`, background: METRICS[visible.length % METRICS.length]!.color }} /></span>
        </div>}
      </div>
    </div>
  </div>;
}

function ScatterChart({ rows, xMetric, yMetric, selectedId, select, metricCopy }: { rows: ReportChartDatum[]; xMetric: ReportMetric; yMetric: ReportMetric; selectedId?: string; select: (row: ReportChartDatum) => void; metricCopy?: MetricCopy }) {
  const xValues = rows.map((row) => row[xMetric]);
  const yValues = rows.map((row) => row[yMetric]);
  const relation = correlation(xValues, yValues);
  const xMin = Math.min(...xValues, 0), xMax = Math.max(...xValues, 1), yMin = Math.min(...yValues, 0), yMax = Math.max(...yValues, 1);
  const xRange = Math.max(xMax - xMin, 1), yRange = Math.max(yMax - yMin, 1);
  const left = 68, right = 770, top = 25, bottom = 260;
  const xAt = (value: number) => left + (value - xMin) / xRange * (right - left);
  const yAt = (value: number) => top + (yMax - value) / yRange * (bottom - top);
  return <div className="advanced-scatter-layout"><div className="advanced-scatter-summary"><span><small>Pearson r</small><strong>{relation.r.toFixed(3)}</strong></span><span><small>R²</small><strong>{(relation.r ** 2).toFixed(3)}</strong></span><span><small>ความสัมพันธ์</small><strong>{relationshipLabel(relation.r)}</strong></span></div><svg viewBox="0 0 820 315" role="img" aria-label={`กราฟความสัมพันธ์ ${configOf(xMetric, metricCopy).label} กับ ${configOf(yMetric, metricCopy).label}`}>
    {[0, 1, 2, 3, 4].map((step) => { const x = left + step / 4 * (right - left), y = top + step / 4 * (bottom - top); return <g key={step}><line className="advanced-gridline" x1={left} x2={right} y1={y} y2={y} /><line className="advanced-gridline" x1={x} x2={x} y1={top} y2={bottom} /><text className="advanced-axis-label" x={left - 8} y={y + 4}>{COMPACT.format(yMax - step / 4 * yRange)}</text><text className="advanced-x-label" x={x} y="284">{COMPACT.format(xMin + step / 4 * xRange)}</text></g>; })}
    <line className="advanced-regression-line" x1={xAt(xMin)} x2={xAt(xMax)} y1={yAt(relation.intercept + relation.slope * xMin)} y2={yAt(relation.intercept + relation.slope * xMax)} />
    {rows.map((row) => <circle key={row.id} className={selectedId === row.id ? "selected" : undefined} cx={xAt(row[xMetric])} cy={yAt(row[yMetric])} r={selectedId === row.id ? 7 : 5} role="button" tabIndex={0} aria-label={`${row.name} · ${configOf(xMetric, metricCopy).label} ${formatted(row[xMetric], xMetric)} · ${configOf(yMetric, metricCopy).label} ${formatted(row[yMetric], yMetric)}`} onClick={() => select(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(row); }} />)}
    <text className="advanced-axis-title" x={(left + right) / 2} y="307">{configOf(xMetric, metricCopy).label}</text><text className="advanced-axis-title" transform={`translate(15 ${(top + bottom) / 2}) rotate(-90)`}>{configOf(yMetric, metricCopy).label}</text>
  </svg></div>;
}

function DistributionChart({ rows, metrics, metricCopy }: { rows: ReportChartDatum[]; metrics: ReportMetric[]; metricCopy?: MetricCopy }) {
  return <div className="advanced-distribution"><div className="advanced-boxplots">{metrics.map((metric) => {
    const stat = statistics(rows.map((row) => row[metric]));
    const range = Math.max(stat.max - stat.min, 1);
    const position = (value: number) => (value - stat.min) / range * 100;
    return <div key={metric}><header><i style={{ background: configOf(metric, metricCopy).color }} /><strong>{configOf(metric, metricCopy).label}</strong><span>n = {stat.count}</span></header><div className="advanced-boxplot"><span style={{ left: `${position(stat.q1)}%`, width: `${Math.max(position(stat.q3) - position(stat.q1), 1)}%`, borderColor: configOf(metric, metricCopy).color }} /><i style={{ left: `${position(stat.median)}%`, background: configOf(metric, metricCopy).color }} /><u style={{ left: `${position(stat.mean)}%` }} /></div><small>Min {COMPACT.format(stat.min)} · Q1 {COMPACT.format(stat.q1)} · Median {COMPACT.format(stat.median)} · Q3 {COMPACT.format(stat.q3)} · Max {COMPACT.format(stat.max)}</small></div>;
  })}</div><div className="report-viz-table advanced-stat-table"><table><thead><tr><th>ตัวชี้วัด</th><th className="num">Mean</th><th className="num">Median</th><th className="num">SD</th><th className="num">CV</th><th className="num">IQR</th></tr></thead><tbody>{metrics.map((metric) => { const stat = statistics(rows.map((row) => row[metric])); return <tr key={metric}><td><i style={{ background: configOf(metric, metricCopy).color }} /><b>{configOf(metric, metricCopy).label}</b></td><td className="num">{COMPACT.format(stat.mean)}</td><td className="num">{COMPACT.format(stat.median)}</td><td className="num">{COMPACT.format(stat.deviation)}</td><td className="num">{stat.cv.toFixed(1)}%</td><td className="num">{COMPACT.format(stat.q3 - stat.q1)}</td></tr>; })}</tbody></table></div></div>;
}

function DataTable({ rows, metrics, selectedId, select, metricCopy }: { rows: ReportChartDatum[]; metrics: ReportMetric[]; selectedId?: string; select: (row: ReportChartDatum) => void; metricCopy?: MetricCopy }) {
  const primary = metrics[0]!;
  return <div className="report-viz-table"><table><thead><tr><th>ข้อมูล</th>{metrics.map((metric) => <th key={metric} className="num">{configOf(metric, metricCopy).label}</th>)}</tr></thead><tbody>{[...rows].sort((a, b) => Math.abs(b[primary]) - Math.abs(a[primary])).map((row) => <tr key={row.id} className={selectedId === row.id ? "selected" : undefined} tabIndex={0} onClick={() => select(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(row); }}><td><b>{row.code}</b><small>{row.name}</small></td>{metrics.map((metric) => <td key={metric} className={`num ${row[metric] < 0 ? "negative" : ""}`}><strong>{formatted(row[metric], metric)}</strong></td>)}</tr>)}</tbody></table></div>;
}

export function ReportChart({ datasets, initialDimension, variant = "business" }: { datasets: ReportChartDataset[]; initialDimension?: string; variant?: ReportChartVariant }) {
  const customerBehavior = variant === "customer-behavior";
  const metricCopy = customerBehavior ? CUSTOMER_BEHAVIOR_METRICS : undefined;
  const available = datasets.filter((item) => item.rows.length);
  const [dimension, setDimension] = useState(initialDimension ?? available[0]?.key ?? datasets[0]?.key ?? "");
  const [mode, setMode] = useState<AnalysisMode>("business");
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [metrics, setMetrics] = useState<ReportMetric[]>(["gross"]);
  const [metricNotice, setMetricNotice] = useState<string | null>(null);
  const [showMetricPicker, setShowMetricPicker] = useState(false);
  const dataset = datasets.find((item) => item.key === dimension) ?? available[0] ?? datasets[0];
  const allowedMetrics = dataset?.metrics?.length ? dataset.metrics : ALL_METRICS;
  const activeMetrics = metrics.filter((metric) => allowedMetrics.includes(metric));
  const selectedMetrics = activeMetrics.length ? activeMetrics : [allowedMetrics[0] ?? "gross"];
  const primary = selectedMetrics[0]!;
  const [selectedId, setSelectedId] = useState<string | undefined>(dataset?.rows[0]?.id);
  const selected = dataset?.rows.find((row) => row.id === selectedId) ?? dataset?.rows[0];
  const chartOptions = mode === "business" ? BUSINESS_CHARTS : ENGINEER_CHARTS;

  useEffect(() => {
    setSelectedId(dataset?.rows[0]?.id);
    setMetrics((current) => {
      const valid = current.filter((metric) => allowedMetrics.includes(metric));
      return valid.length ? valid : [allowedMetrics[0] ?? "gross"];
    });
  }, [dataset?.key]);

  const totals = useMemo(() => dataset?.rows.reduce((sum, row) => ({ gross: sum.gross + row.gross, payout: sum.payout + row.payout, commission: sum.commission + row.commission, net: sum.net + row.net, bills: sum.bills + row.bills, items: sum.items + row.items, winners: sum.winners + row.winners }), { gross: 0, payout: 0, commission: 0, net: 0, bills: 0, items: 0, winners: 0 }), [dataset]);
  const primaryStats = statistics(dataset?.rows.map((row) => row[primary]) ?? []);
  const highest = dataset?.rows.reduce<ReportChartDatum | undefined>((top, row) => !top || Math.abs(row[primary]) > Math.abs(top[primary]) ? row : top, undefined);
  const select = (row: ReportChartDatum) => setSelectedId(row.id);

  function changeMode(next: string) {
    const nextMode = next as AnalysisMode;
    setMode(nextMode);
    setShowMetricPicker(false);
    setChartType(nextMode === "business" ? "bar" : "comparison");
    if (nextMode === "business") setMetrics([primary]);
    if (nextMode === "engineer" && selectedMetrics.length < 2) {
      const second = allowedMetrics.find((metric) => metric !== primary);
      if (second) setMetrics([primary, second]);
    }
  }

  function toggleMetric(metric: ReportMetric) {
    setMetricNotice(null);
    setMetrics((current) => {
      if (current.includes(metric)) {
        if (current.length === 1) { setMetricNotice("ต้องเลือกอย่างน้อย 1 ตัวชี้วัด"); return current; }
        return current.filter((item) => item !== metric);
      }
      if (current.length >= 4) { setMetricNotice("เลือกเปรียบเทียบพร้อมกันได้สูงสุด 4 ตัวชี้วัด"); return current; }
      return [...current, metric];
    });
  }

  function selectBusinessMetric(metric: ReportMetric) {
    setMetricNotice(null);
    setMetrics([metric]);
  }

  const chartDescription = mode === "engineer"
    ? customerBehavior
      ? "โหมดสถิติวิเคราะห์ความสัมพันธ์ระหว่างมูลค่าการซื้อ ความถี่ และจำนวนเลขที่เลือก โดยไม่เปลี่ยนข้อมูลต้นทาง"
      : "โหมดวิศวกรรมสถิติแสดงสูตรเชิงเปรียบเทียบ ความสัมพันธ์ และการกระจาย โดยไม่เปลี่ยนข้อมูลต้นทาง"
    : selectedMetrics.length > 1
      ? "เมื่อเทียบคนละหน่วย ระบบแปลงแต่ละชุดเป็นดัชนีสูงสุด 100 เพื่อไม่ให้สเกลใหญ่กลบสเกลเล็ก"
      : customerBehavior
        ? "มุมมองนี้ช่วยดูว่าใครซื้อบ่อย ซื้ออะไร ซื้อช่วงไหน และพฤติกรรมเปลี่ยนไปอย่างไร"
        : "มุมมอง Business Analysis เน้นอ่านง่าย เห็นอันดับ แนวโน้ม และตัวเลขสำคัญทันที";

  if (mode === "business") {
    const businessChartOptions = BUSINESS_CHARTS;
    return <section className="report-panel report-chart-panel report-visual-center advanced-analytics business-friendly" aria-labelledby="performance-chart-heading">
      <div className="report-viz-heading business-friendly-heading">
        <div className="report-viz-title"><span className="report-viz-title-icon" aria-hidden="true">▥</span><div><span className="report-kicker">{customerBehavior ? "CUSTOMER BEHAVIOR OVERVIEW" : "BUSINESS OVERVIEW"}</span><h2 id="performance-chart-heading">{customerBehavior ? "ภาพรวมพฤติกรรมลูกค้า" : "ดูข้อมูลสำคัญแบบเข้าใจง่าย"}</h2><p>{customerBehavior ? "ดูว่าใครซื้อบ่อย ซื้ออะไร ซื้อช่วงไหน และกลุ่มใดสร้างมูลค่าหลัก" : "เลือกสิ่งที่อยากดู แล้วกราฟจะอัปเดตทันที"}</p></div></div>
        <button type="button" className="business-engineer-switch" onClick={() => changeMode("engineer")}><span>Σ</span><div><b>โหมดนักสถิติ</b><small>Z-score · Correlation · Distribution</small></div><em>เปิด →</em></button>
      </div>

      <div className="business-simple-controls">
        <section className="business-primary-control"><span><b>1</b> {customerBehavior ? "ต้องการเข้าใจพฤติกรรมด้านใด?" : "อยากดูข้อมูลอะไร?"}</span><div role="group" aria-label="เลือกข้อมูลหลัก">{allowedMetrics.slice(0, 4).map((metric) => { const config = configOf(metric, metricCopy); return <button type="button" key={metric} className={primary === metric ? "active" : undefined} aria-pressed={primary === metric} onClick={() => selectBusinessMetric(metric)}><i style={{ background: config.color }} />{config.label}</button>; })}</div></section>
        <label><span><b>2</b> {customerBehavior ? "วิเคราะห์แยกตาม" : "เปรียบเทียบตาม"}</span><AppDropdown value={dataset?.key} onValueChange={setDimension} ariaLabel="เลือกมิติข้อมูล" options={datasets.map((item) => ({ value: item.key, label: item.label, description: item.description, badge: item.rows.length.toLocaleString("th-TH") }))} /></label>
        <label><span><b>3</b> รูปแบบกราฟ</span><AppDropdown value={chartType} onValueChange={(value) => setChartType(value as ChartType)} ariaLabel="เลือกรูปแบบกราฟ" options={businessChartOptions} /></label>
        <button type="button" className={`business-compare-toggle ${showMetricPicker || selectedMetrics.length > 1 ? "active" : ""}`} onClick={() => setShowMetricPicker((value) => !value)}><span>＋</span><div><b>เพิ่มค่ามาเปรียบเทียบ</b><small>{selectedMetrics.length > 1 ? `เลือกอยู่ ${selectedMetrics.length} ค่า` : "ไม่จำเป็นต้องใช้ก็ได้"}</small></div></button>
      </div>

      {showMetricPicker && <div className="advanced-metric-selector business-metric-picker"><div><strong>เลือกค่าที่ต้องการวางเทียบกัน</strong><small>เลือกได้สูงสุด 4 ค่า · กดซ้ำเพื่อยกเลิก</small></div><div role="group" aria-label="เลือกตัวชี้วัด">{allowedMetrics.map((metric) => { const config = configOf(metric, metricCopy); const active = selectedMetrics.includes(metric); return <button type="button" key={metric} className={active ? "active" : undefined} aria-pressed={active} onClick={() => toggleMetric(metric)}><i style={{ background: config.color }} /><span><b>{config.label}</b><small>{config.description}</small></span><em>{active ? "✓" : "+"}</em></button>; })}</div>{metricNotice && <p role="status">{metricNotice}</p>}</div>}

      {selectedMetrics.length > 1 && <div className="business-scale-note"><span aria-hidden="true">ⓘ</span><p>{chartDescription}</p><button type="button" onClick={() => setMetrics([primary])}>เหลือค่าเดียว</button></div>}

      {dataset && <div className="business-summary-strip"><span><small>{configOf(primary, metricCopy).label}รวม</small><strong className={(totals?.[primary] ?? 0) < 0 ? "negative" : undefined}>{formatted(totals?.[primary] ?? 0, primary)}</strong></span><span><small>ค่าเฉลี่ยต่อรายการ</small><strong>{formatted(primaryStats.mean, primary)}</strong></span><span><small>สูงสุด</small><strong>{highest ? formatted(highest[primary], primary) : "—"}</strong><em>{highest?.name ?? "ยังไม่มีข้อมูล"}</em></span><span className="business-row-count"><strong>{dataset.rows.length.toLocaleString("th-TH")}</strong><small>รายการที่นำมาวิเคราะห์</small></span></div>}

      {!dataset || !dataset.rows.length ? <div className="report-empty">ยังไม่มีข้อมูลสำหรับสร้างกราฟ</div> : <div className="report-viz-workspace business-workspace"><div className="report-viz-canvas" data-chart={chartType}>
        <div className="business-chart-heading"><div><span>{dataset.label}</span><strong>{businessChartOptions.find((option) => option.value === chartType)?.label} · {configOf(primary, metricCopy).label}</strong></div><div>{selectedMetrics.map((metric) => <i key={metric}><u style={{ background: configOf(metric, metricCopy).color }} />{configOf(metric, metricCopy).label}</i>)}</div></div>
        {(chartType === "bar" || chartType === "line") && <ComparisonChart rows={dataset.rows} metrics={selectedMetrics} mode="business" type={chartType} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
        {chartType === "donut" && <DonutChart rows={dataset.rows} metric={primary} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
        {chartType === "table" && <DataTable rows={dataset.rows} metrics={selectedMetrics} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
        {selected && <div className="business-selected-row" aria-live="polite"><span><small>รายการที่เลือก</small><strong>{selected.code} · {selected.name}</strong></span><span><small>{configOf(primary, metricCopy).label}</small><strong className={selected[primary] < 0 ? "negative" : undefined}>{formatted(selected[primary], primary)}</strong></span><span><small>สัดส่วน</small><strong>{Math.abs(selected[primary]) && totals ? `${(Math.abs(selected[primary]) / Math.max(Math.abs(totals[primary]), 1) * 100).toFixed(1)}%` : "—"}</strong></span>{selected.href ? <a href={selected.href}>ดูรายละเอียด →</a> : <small>คลิกแท่งอื่นเพื่อเปลี่ยนรายการ</small>}</div>}
      </div></div>}
    </section>;
  }

  return <section className="report-panel report-chart-panel report-visual-center advanced-analytics" aria-labelledby="performance-chart-heading">
    <div className="report-viz-heading"><div className="report-viz-title"><span className="report-viz-title-icon" aria-hidden="true">Σ</span><div><span className="report-kicker">{customerBehavior ? "CUSTOMER BEHAVIOR STATISTICS" : "ADVANCED STATISTICAL CHARTING"}</span><h2 id="performance-chart-heading">{customerBehavior ? "Customer Behavior Data Science" : "Business Analysis & Data Science"}</h2><p>{customerBehavior ? "วิเคราะห์ความสัมพันธ์ การกระจาย และรูปแบบการซื้อจากข้อมูลลูกค้าจริง" : "เลือกมุมมองและตัวชี้วัด แล้วระบบจะแสดงกราฟเพียงหนึ่งแบบเพื่อให้วิเคราะห์ได้ชัดเจน"}</p></div></div><span className="advanced-mode-badge is-engineer">Statistic Engineer</span></div>
    <div className="advanced-chart-selectors">
      <label><span>ระดับการวิเคราะห์</span><AppDropdown value={mode} onValueChange={changeMode} ariaLabel="เลือกระดับการวิเคราะห์" options={[{ value: "business", label: customerBehavior ? "Customer Overview — เข้าใจง่าย" : "Business Analysis — เข้าใจง่าย", description: customerBehavior ? "เหมาะสำหรับดูภาพรวมพฤติกรรมลูกค้า" : "เหมาะสำหรับดูภาพรวมและตัดสินใจ" }, { value: "engineer", label: "Statistic Engineer", description: "Z-score, Correlation, Regression และ Distribution" }]} /></label>
      <label><span>รูปแบบที่แสดง</span><AppDropdown value={chartType} onValueChange={(value) => setChartType(value as ChartType)} ariaLabel="เลือกรูปแบบกราฟ" options={chartOptions} /></label>
      {datasets.length > 1 && <label><span>มิติข้อมูล</span><AppDropdown value={dataset?.key} onValueChange={setDimension} ariaLabel="เลือกมิติข้อมูล" options={datasets.map((item) => ({ value: item.key, label: item.label, description: item.description, badge: item.rows.length.toLocaleString("th-TH") }))} /></label>}
    </div>
    <div className="advanced-metric-selector"><div><strong>ตัวชี้วัดที่ต้องการเปรียบเทียบ</strong><small>เลือกได้สูงสุด 4 ค่า · สีเดียวกันใช้ตลอดทุกกราฟ</small></div><div role="group" aria-label="เลือกตัวชี้วัด">{allowedMetrics.map((metric) => { const config = configOf(metric, metricCopy); const active = selectedMetrics.includes(metric); return <button type="button" key={metric} className={active ? "active" : undefined} aria-pressed={active} onClick={() => toggleMetric(metric)}><i style={{ background: config.color }} /><span><b>{config.label}</b><small>{config.description}</small></span><em>{active ? "✓" : "+"}</em></button>; })}</div>{metricNotice && <p role="status">{metricNotice}</p>}</div>
    <div className="advanced-analysis-note"><span aria-hidden="true">ⓘ</span><p>{chartDescription}</p></div>
    {dataset && <div className="report-viz-summary"><span><small>มุมมองปัจจุบัน</small><strong>{dataset.label}</strong><em>{dataset.rows.length.toLocaleString("th-TH")} รายการ</em></span><span><small>{configOf(primary, metricCopy).label}รวม</small><strong className={(totals?.[primary] ?? 0) < 0 ? "negative" : undefined}>{formatted(totals?.[primary] ?? 0, primary)}</strong><em>ตัวชี้วัดหลักที่เลือก</em></span><span><small>Mean / Median</small><strong>{COMPACT.format(primaryStats.mean)} / {COMPACT.format(primaryStats.median)}</strong><em>ค่าเฉลี่ยและค่ากลาง</em></span><span><small>ค่าสูงสุด</small><strong>{highest ? formatted(highest[primary], primary) : "—"}</strong><em>{highest?.name ?? "ยังไม่มีข้อมูล"}</em></span></div>}
    {!dataset || !dataset.rows.length ? <div className="report-empty">ยังไม่มีข้อมูลสำหรับสร้างกราฟ</div> : <div className="report-viz-workspace"><div className="report-viz-canvas" data-chart={chartType}><div className="report-viz-canvas-heading"><div><span>STATISTICAL MODEL</span><strong>{chartOptions.find((option) => option.value === chartType)?.label} · {dataset.label}</strong></div><small>{selectedMetrics.map((metric) => configOf(metric, metricCopy).label).join(" · ")}<br />คลิกจุดหรือแท่งเพื่อเจาะรายละเอียด</small></div>
      {(chartType === "bar" || chartType === "line" || chartType === "comparison") && <ComparisonChart rows={dataset.rows} metrics={selectedMetrics} mode={mode} type={chartType} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
      {chartType === "donut" && <DonutChart rows={dataset.rows} metric={primary} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
      {chartType === "scatter" && <ScatterChart rows={dataset.rows} xMetric={selectedMetrics[0]!} yMetric={selectedMetrics[1] ?? allowedMetrics.find((metric) => metric !== selectedMetrics[0]) ?? selectedMetrics[0]!} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
      {chartType === "distribution" && <DistributionChart rows={dataset.rows} metrics={selectedMetrics} metricCopy={metricCopy} />}
      {chartType === "table" && <DataTable rows={dataset.rows} metrics={selectedMetrics} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
    </div>{selected && <aside className="report-drilldown" aria-live="polite"><div className="report-drilldown-title"><span>เจาะรายละเอียด</span><b>{selected.code}</b><h3>{selected.name}</h3></div><div className="report-drilldown-focus"><small>{configOf(primary, metricCopy).label}</small><strong className={selected[primary] < 0 ? "negative" : undefined}>{formatted(selected[primary], primary)}</strong><span>{Math.abs(selected[primary]) && totals ? `${(Math.abs(selected[primary]) / Math.max(Math.abs(totals[primary]), 1) * 100).toFixed(1)}% ของทั้งหมด` : "ยังไม่มีสัดส่วน"}</span></div><dl>{selectedMetrics.map((metric) => <div key={metric}><dt>{configOf(metric, metricCopy).label}</dt><dd className={selected[metric] < 0 ? "negative" : ""}>{formatted(selected[metric], metric)}</dd></div>)}</dl>{!customerBehavior && selected.gross !== 0 && <div className="report-drilldown-ratio"><span>อัตราจ่ายรางวัล</span><b>{(selected.payout / selected.gross * 100).toFixed(1)}%</b><i><u style={{ width: `${Math.min(Math.abs(selected.payout / selected.gross * 100), 100)}%` }} /></i></div>}{selected.href && <a href={selected.href}>ดูข้อมูลเจาะลึก →</a>}</aside>}</div>}
  </section>;
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { AppDropdown } from "../AppDropdown";
import { CustomerBehaviorChartBuilder } from "../analytics/CustomerBehaviorChartBuilder";
import { LazyCustomChartBuilder } from "./LazyCustomChartBuilder";

export type ReportMetric = "gross" | "payout" | "commission" | "net" | "bills" | "items" | "winners";
export type ReportChartDatum = {
  id: string;
  code: string;
  name: string;
  href?: string;
  date?: string;
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
const REPORT_QUESTIONS: Array<{ value: string; label: string; dimension: string; metric: ReportMetric; chart: ChartType }> = [
  { value: "sales-draw", label: "ยอดขายแต่ละงวดเป็นอย่างไร", dimension: "draws", metric: "gross", chart: "line" },
  { value: "net-draw", label: "งวดไหนมียอดสุทธิสูงหรือต่ำ", dimension: "draws", metric: "net", chart: "bar" },
  { value: "payout-draw", label: "จ่ายรางวัลแต่ละงวดเท่าไร", dimension: "draws", metric: "payout", chart: "bar" },
  { value: "sales-agent", label: "Agent คนไหนมียอดขายสูง", dimension: "agents", metric: "gross", chart: "bar" },
  { value: "sales-prize", label: "ยอดขายแยกตามประเภทรางวัล", dimension: "prizes", metric: "gross", chart: "bar" },
];
const CUSTOMER_QUESTIONS: typeof REPORT_QUESTIONS = [
  { value: "customer-sales", label: "ลูกค้าคนไหนมียอดซื้อสูง", dimension: "customers", metric: "gross", chart: "bar" },
  { value: "customer-frequency", label: "ลูกค้าคนไหนซื้อบ่อย", dimension: "customers", metric: "bills", chart: "bar" },
  { value: "purchase-time", label: "ลูกค้าซื้อช่วงเวลาไหน", dimension: "time", metric: "bills", chart: "bar" },
  { value: "purchase-trend", label: "ยอดซื้อเปลี่ยนไปตามงวดอย่างไร", dimension: "timeline", metric: "gross", chart: "line" },
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

function ComparisonChart({ rows, metrics, mode, type, selectedId, select, metricCopy, dimension }: {
  rows: ReportChartDatum[];
  metrics: ReportMetric[];
  mode: AnalysisMode;
  type: "bar" | "line" | "comparison";
  selectedId?: string;
  select: (row: ReportChartDatum) => void;
  metricCopy?: MetricCopy;
  dimension: string;
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
  const rawMinimum = Math.min(...allValues, 0);
  const rawMaximum = Math.max(...allValues, 1);
  const [rangeMode, setRangeMode] = useState<TrendRangeMode>("zero");
  const [minimumInput, setMinimumInput] = useState(String(niceFloor(rawMinimum)));
  const [maximumInput, setMaximumInput] = useState(String(niceCeiling(rawMaximum)));
  useEffect(() => {
    setMinimumInput(String(niceFloor(rawMinimum)));
    setMaximumInput(String(niceCeiling(rawMaximum)));
  }, [dimension, metrics.join("|"), rawMinimum, rawMaximum]);
  const customMinimum = Number(minimumInput);
  const customMaximum = Number(maximumInput);
  const validCustomRange = Number.isFinite(customMinimum) && Number.isFinite(customMaximum) && customMaximum > customMinimum;
  const focusPadding = Math.max((rawMaximum - rawMinimum) * .1, Math.abs(rawMaximum) * .03, 1);
  const minimum = rangeMode === "focus" ? rawMinimum - focusPadding : rangeMode === "custom" && validCustomRange ? customMinimum : Math.min(0, niceFloor(rawMinimum));
  const maximum = rangeMode === "focus" ? rawMaximum + focusPadding : rangeMode === "custom" && validCustomRange ? customMaximum : Math.max(0, niceCeiling(rawMaximum));
  const range = Math.max(maximum - minimum, 1);
  const left = 58, right = 785, top = 28, bottom = 254;
  const xAt = (index: number) => visible.length === 1 ? (left + right) / 2 : left + index / (visible.length - 1) * (right - left);
  const yAt = (value: number) => top + (maximum - value) / range * (bottom - top);
  const baseline = minimum > 0 ? minimum : maximum < 0 ? maximum : 0;
  const zeroY = yAt(baseline);
  const scaleLabel = mode === "engineer" ? "Z-score (จำนวนส่วนเบี่ยงเบนมาตรฐาน)" : metrics.length > 1 ? "ดัชนีเทียบค่าสูงสุดของแต่ละชุด = 100" : configOf(metrics[0]!, metricCopy).money ? "บาท" : "จำนวน";

  return <div className="advanced-comparison-chart">
    <div className="chart-axis-value-settings" aria-label="กำหนดค่าแกน Y">
      <div className="chart-axis-value-heading"><span>2</span><div><strong>กำหนดค่าแกน Y</strong><small>{configOf(metrics[0]!, metricCopy).label} · {scaleLabel}</small></div></div>
      <label><span>รูปแบบช่วงค่า</span><AppDropdown value={rangeMode} onValueChange={(value) => setRangeMode(value as TrendRangeMode)} ariaLabel="เลือกช่วงแกน Y" options={[{ value: "zero", label: "อัตโนมัติ เริ่มจาก 0", description: "เหมาะกับการเปรียบเทียบสัดส่วน" }, { value: "focus", label: "เน้นช่วงข้อมูล", description: "ขยายความแตกต่างของข้อมูล" }, { value: "custom", label: "กำหนดช่วงเอง", description: "ระบุค่าต่ำสุดและสูงสุด" }]} /></label>
      {rangeMode === "custom" && <fieldset className="chart-axis-custom-range"><legend>กำหนดช่วง {scaleLabel}</legend><label><span>ต่ำสุด</span><input type="number" inputMode="decimal" value={minimumInput} onChange={(event) => setMinimumInput(event.target.value)} /></label><label><span>สูงสุด</span><input type="number" inputMode="decimal" value={maximumInput} onChange={(event) => setMaximumInput(event.target.value)} /></label>{!validCustomRange && <small role="alert">ค่าสูงสุดต้องมากกว่าค่าต่ำสุด</small>}</fieldset>}
    </div>
    <div className="advanced-chart-legend"><span>{scaleLabel}</span>{metrics.map((metric) => <i key={metric}><u style={{ background: configOf(metric, metricCopy).color }} />{configOf(metric, metricCopy).label}</i>)}</div>
    <svg viewBox="0 0 840 305" role="img" aria-label={`กราฟเปรียบเทียบ ${metrics.map((metric) => configOf(metric, metricCopy).label).join(" และ ")}`}>
      <defs><clipPath id="comparison-chart-plot"><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
      {[0, 1, 2, 3, 4].map((step) => { const y = top + step / 4 * (bottom - top); const value = maximum - step / 4 * range; return <g key={step}><line className="advanced-gridline" x1={left} x2={right} y1={y} y2={y} /><text className="advanced-axis-label" x={left - 9} y={y + 4}>{mode === "engineer" ? value.toFixed(1) : COMPACT.format(value)}</text></g>; })}
      {minimum < 0 && <line className="advanced-zero-line" x1={left} x2={right} y1={zeroY} y2={zeroY} />}
      <g clipPath="url(#comparison-chart-plot)">{type === "bar" ? visible.flatMap((row, rowIndex) => {
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
      })}</g>
      {visible.map((row, index) => (visible.length <= 8 || index % 2 === 0 || index === visible.length - 1) && <text key={row.id} className="advanced-x-label" x={xAt(index)} y="283">{row.code.slice(0, 11)}</text>)}
    </svg>
  </div>;
}

type TrendRangeMode = "zero" | "focus" | "custom";

function niceCeiling(value: number) {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

function niceFloor(value: number) {
  if (value >= 0) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(Math.abs(value)));
  return Math.floor(value / magnitude) * magnitude;
}

function CustomerTrendChart({ rows, selectedId, select, metricCopy, xDimension, onXDimensionChange }: {
  rows: ReportChartDatum[];
  selectedId?: string;
  select: (row: ReportChartDatum) => void;
  metricCopy?: MetricCopy;
  xDimension: "timeline" | "time";
  onXDimensionChange: (dimension: "timeline" | "time") => void;
}) {
  const visible = rows.slice(-12);
  const moneyMetric: ReportMetric = "gross";
  const countMetric: ReportMetric = "bills";
  const moneyConfig = configOf(moneyMetric, metricCopy);
  const countConfig = configOf(countMetric, metricCopy);
  const rawMoneyMin = Math.min(...visible.map((row) => row[moneyMetric]), 0);
  const rawMoneyMax = Math.max(...visible.map((row) => row[moneyMetric]), 1);
  const rawCountMin = Math.min(...visible.map((row) => row[countMetric]), 0);
  const rawCountMax = Math.max(...visible.map((row) => row[countMetric]), 1);
  const [rangeMode, setRangeMode] = useState<TrendRangeMode>("zero");
  const [moneyMinInput, setMoneyMinInput] = useState("0");
  const [moneyMaxInput, setMoneyMaxInput] = useState(String(niceCeiling(rawMoneyMax)));
  const [countMinInput, setCountMinInput] = useState("0");
  const [countMaxInput, setCountMaxInput] = useState(String(niceCeiling(rawCountMax)));

  useEffect(() => {
    setMoneyMinInput("0");
    setMoneyMaxInput(String(niceCeiling(rawMoneyMax)));
    setCountMinInput("0");
    setCountMaxInput(String(niceCeiling(rawCountMax)));
  }, [xDimension, rawMoneyMax, rawCountMax]);

  const focusedMoneyPadding = Math.max((rawMoneyMax - rawMoneyMin) * .1, rawMoneyMax * .03, 1);
  const focusedCountPadding = Math.max((rawCountMax - rawCountMin) * .1, rawCountMax * .03, 1);
  const customMoneyMin = Number(moneyMinInput);
  const customMoneyMax = Number(moneyMaxInput);
  const customCountMin = Number(countMinInput);
  const customCountMax = Number(countMaxInput);
  const validMoneyCustom = Number.isFinite(customMoneyMin) && Number.isFinite(customMoneyMax) && customMoneyMax > customMoneyMin;
  const validCountCustom = Number.isFinite(customCountMin) && Number.isFinite(customCountMax) && customCountMax > customCountMin;
  const moneyMin = rangeMode === "focus" ? Math.max(0, rawMoneyMin - focusedMoneyPadding) : rangeMode === "custom" && validMoneyCustom ? customMoneyMin : 0;
  const moneyMax = rangeMode === "focus" ? rawMoneyMax + focusedMoneyPadding : rangeMode === "custom" && validMoneyCustom ? customMoneyMax : niceCeiling(rawMoneyMax);
  const countMin = rangeMode === "focus" ? Math.max(0, rawCountMin - focusedCountPadding) : rangeMode === "custom" && validCountCustom ? customCountMin : 0;
  const countMax = rangeMode === "focus" ? rawCountMax + focusedCountPadding : rangeMode === "custom" && validCountCustom ? customCountMax : niceCeiling(rawCountMax);
  const moneyRange = Math.max(moneyMax - moneyMin, 1);
  const countRange = Math.max(countMax - countMin, 1);
  const left = 68, right = 770, top = 30, bottom = 250;
  const xAt = (index: number) => visible.length === 1 ? (left + right) / 2 : left + index / (visible.length - 1) * (right - left);
  const moneyY = (value: number) => bottom - (value - moneyMin) / moneyRange * (bottom - top);
  const countY = (value: number) => bottom - (value - countMin) / countRange * (bottom - top);
  const moneyPoints = visible.map((row, index) => ({ row, x: xAt(index), y: moneyY(row[moneyMetric]) }));
  const countPoints = visible.map((row, index) => ({ row, x: xAt(index), y: countY(row[countMetric]) }));
  const pathOf = (points: Array<{ x: number; y: number }>) => points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  const xLabel = xDimension === "timeline" ? "วันออกรางวัล" : "ช่วงเวลาที่ซื้อ";

  return <div className="advanced-comparison-chart customer-trend-chart">
    <div className="customer-trend-controls" aria-label="กำหนดแกนกราฟแนวโน้ม">
      <label><span>ข้อมูลแกน X</span><AppDropdown value={xDimension} onValueChange={(value) => onXDimensionChange(value as "timeline" | "time")} ariaLabel="เลือกข้อมูลแกน X" options={[{ value: "timeline", label: "วันออกรางวัล", description: "เรียงแนวโน้มตามวันที่" }, { value: "time", label: "ช่วงเวลาที่ซื้อ", description: "เช้า บ่าย และเย็น/ค่ำ" }]} /></label>
      <label><span>ช่วงแกน Y</span><AppDropdown value={rangeMode} onValueChange={(value) => setRangeMode(value as TrendRangeMode)} ariaLabel="เลือกช่วงแกน Y" options={[{ value: "zero", label: "อัตโนมัติ เริ่มจาก 0", description: "เห็นสัดส่วนจากฐานศูนย์" }, { value: "focus", label: "เน้นช่วงข้อมูล", description: "ขยายความแตกต่างของข้อมูล" }, { value: "custom", label: "กำหนดช่วงเอง", description: "ระบุค่าต่ำสุดและสูงสุด" }]} /></label>
      {rangeMode === "custom" && <div className="customer-trend-custom-ranges">
        <fieldset><legend>แกนซ้าย · บาท</legend><label><span>ต่ำสุด</span><input type="number" inputMode="decimal" value={moneyMinInput} onChange={(event) => setMoneyMinInput(event.target.value)} /></label><label><span>สูงสุด</span><input type="number" inputMode="decimal" value={moneyMaxInput} onChange={(event) => setMoneyMaxInput(event.target.value)} /></label>{!validMoneyCustom && <small role="alert">ค่าสูงสุดต้องมากกว่าค่าต่ำสุด</small>}</fieldset>
        <fieldset><legend>แกนขวา · จำนวนครั้ง</legend><label><span>ต่ำสุด</span><input type="number" inputMode="numeric" step="1" value={countMinInput} onChange={(event) => setCountMinInput(event.target.value)} /></label><label><span>สูงสุด</span><input type="number" inputMode="numeric" step="1" value={countMaxInput} onChange={(event) => setCountMaxInput(event.target.value)} /></label>{!validCountCustom && <small role="alert">ค่าสูงสุดต้องมากกว่าค่าต่ำสุด</small>}</fieldset>
      </div>}
    </div>
    <div className="advanced-chart-legend customer-trend-legend"><span>แกน X · {xLabel}</span><i><u style={{ background: moneyConfig.color }} />แกนซ้าย · {moneyConfig.label} (บาท)</i><i><u style={{ background: countConfig.color }} />แกนขวา · {countConfig.label} (ครั้ง)</i></div>
    <svg viewBox="0 0 840 310" role="img" aria-label={`กราฟแนวโน้ม ${moneyConfig.label}หน่วยบาท และ${countConfig.label}หน่วยครั้ง แยกตาม${xLabel}`}>
      <defs><clipPath id="customer-trend-plot"><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
      {[0, 1, 2, 3, 4].map((step) => {
        const y = top + step / 4 * (bottom - top);
        const moneyValue = moneyMax - step / 4 * moneyRange;
        const countValue = countMax - step / 4 * countRange;
        return <g key={step}><line className="advanced-gridline" x1={left} x2={right} y1={y} y2={y} /><text className="advanced-axis-label" x={left - 10} y={y + 4}>{COMPACT.format(moneyValue)}</text><text className="advanced-axis-label customer-trend-axis-right" x={right + 10} y={y + 4}>{NUMBER.format(Math.round(countValue))}</text></g>;
      })}
      <text className="advanced-axis-title customer-trend-axis-title-left" transform={`translate(14 ${(top + bottom) / 2}) rotate(-90)`}>ยอดซื้อ (บาท)</text>
      <text className="advanced-axis-title customer-trend-axis-title-right" transform={`translate(827 ${(top + bottom) / 2}) rotate(90)`}>ความถี่ซื้อ (ครั้ง)</text>
      <g clipPath="url(#customer-trend-plot)"><path className="advanced-series-line" d={pathOf(moneyPoints)} style={{ stroke: moneyConfig.color }} /><path className="advanced-series-line customer-trend-count-line" d={pathOf(countPoints)} style={{ stroke: countConfig.color }} />
        {moneyPoints.map((point) => <circle key={`money-${point.row.id}`} className={selectedId === point.row.id ? "selected" : undefined} cx={point.x} cy={point.y} r={selectedId === point.row.id ? 6 : 4} fill="#fff" style={{ stroke: moneyConfig.color }} role="button" tabIndex={0} aria-label={`${point.row.name} · ${moneyConfig.label}: ${formatted(point.row[moneyMetric], moneyMetric)}`} onClick={() => select(point.row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(point.row); }} />)}
        {countPoints.map((point) => <circle key={`count-${point.row.id}`} className={selectedId === point.row.id ? "selected" : undefined} cx={point.x} cy={point.y} r={selectedId === point.row.id ? 6 : 4} fill="#fff" style={{ stroke: countConfig.color }} role="button" tabIndex={0} aria-label={`${point.row.name} · ${countConfig.label}: ${NUMBER.format(point.row[countMetric])} ครั้ง`} onClick={() => select(point.row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(point.row); }} />)}
      </g>
      {visible.map((row, index) => (visible.length <= 8 || index % 2 === 0 || index === visible.length - 1) && <text key={row.id} className="advanced-x-label" x={xAt(index)} y="283">{row.code.slice(0, 12)}</text>)}
      <text className="advanced-axis-title customer-trend-x-title" x={(left + right) / 2} y="306">{xLabel}</text>
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
  const xMin = Math.min(...xValues, 0), xMax = Math.max(...xValues, 1);
  const rawYMin = Math.min(...yValues, 0), rawYMax = Math.max(...yValues, 1);
  const [rangeMode, setRangeMode] = useState<TrendRangeMode>("zero");
  const [minimumInput, setMinimumInput] = useState(String(niceFloor(rawYMin)));
  const [maximumInput, setMaximumInput] = useState(String(niceCeiling(rawYMax)));
  useEffect(() => {
    setMinimumInput(String(niceFloor(rawYMin)));
    setMaximumInput(String(niceCeiling(rawYMax)));
  }, [yMetric, rawYMin, rawYMax]);
  const customMinimum = Number(minimumInput);
  const customMaximum = Number(maximumInput);
  const validCustomRange = Number.isFinite(customMinimum) && Number.isFinite(customMaximum) && customMaximum > customMinimum;
  const focusPadding = Math.max((rawYMax - rawYMin) * .1, Math.abs(rawYMax) * .03, 1);
  const yMin = rangeMode === "focus" ? rawYMin - focusPadding : rangeMode === "custom" && validCustomRange ? customMinimum : Math.min(0, niceFloor(rawYMin));
  const yMax = rangeMode === "focus" ? rawYMax + focusPadding : rangeMode === "custom" && validCustomRange ? customMaximum : Math.max(0, niceCeiling(rawYMax));
  const xRange = Math.max(xMax - xMin, 1), yRange = Math.max(yMax - yMin, 1);
  const left = 68, right = 770, top = 25, bottom = 260;
  const xAt = (value: number) => left + (value - xMin) / xRange * (right - left);
  const yAt = (value: number) => top + (yMax - value) / yRange * (bottom - top);
  return <div className="advanced-scatter-layout"><div className="chart-axis-value-settings" aria-label="กำหนดค่าแกน Y">
    <div className="chart-axis-value-heading"><span>2</span><div><strong>กำหนดค่าแกน Y</strong><small>{configOf(yMetric, metricCopy).label}</small></div></div>
    <label><span>รูปแบบช่วงค่า</span><AppDropdown value={rangeMode} onValueChange={(value) => setRangeMode(value as TrendRangeMode)} ariaLabel="เลือกช่วงแกน Y" options={[{ value: "zero", label: "อัตโนมัติ เริ่มจาก 0", description: "เห็นสัดส่วนจากฐานศูนย์" }, { value: "focus", label: "เน้นช่วงข้อมูล", description: "ขยายความแตกต่างของข้อมูล" }, { value: "custom", label: "กำหนดช่วงเอง", description: "ระบุค่าต่ำสุดและสูงสุด" }]} /></label>
    {rangeMode === "custom" && <fieldset className="chart-axis-custom-range"><legend>กำหนดช่วง {configOf(yMetric, metricCopy).label}</legend><label><span>ต่ำสุด</span><input type="number" inputMode="decimal" value={minimumInput} onChange={(event) => setMinimumInput(event.target.value)} /></label><label><span>สูงสุด</span><input type="number" inputMode="decimal" value={maximumInput} onChange={(event) => setMaximumInput(event.target.value)} /></label>{!validCustomRange && <small role="alert">ค่าสูงสุดต้องมากกว่าค่าต่ำสุด</small>}</fieldset>}
  </div><div className="advanced-scatter-summary"><span><small>Pearson r</small><strong>{relation.r.toFixed(3)}</strong></span><span><small>R²</small><strong>{(relation.r ** 2).toFixed(3)}</strong></span><span><small>ความสัมพันธ์</small><strong>{relationshipLabel(relation.r)}</strong></span></div><svg viewBox="0 0 820 315" role="img" aria-label={`กราฟความสัมพันธ์ ${configOf(xMetric, metricCopy).label} กับ ${configOf(yMetric, metricCopy).label}`}>
    <defs><clipPath id="scatter-chart-plot"><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
    {[0, 1, 2, 3, 4].map((step) => { const x = left + step / 4 * (right - left), y = top + step / 4 * (bottom - top); return <g key={step}><line className="advanced-gridline" x1={left} x2={right} y1={y} y2={y} /><line className="advanced-gridline" x1={x} x2={x} y1={top} y2={bottom} /><text className="advanced-axis-label" x={left - 8} y={y + 4}>{COMPACT.format(yMax - step / 4 * yRange)}</text><text className="advanced-x-label" x={x} y="284">{COMPACT.format(xMin + step / 4 * xRange)}</text></g>; })}
    <g clipPath="url(#scatter-chart-plot)"><line className="advanced-regression-line" x1={xAt(xMin)} x2={xAt(xMax)} y1={yAt(relation.intercept + relation.slope * xMin)} y2={yAt(relation.intercept + relation.slope * xMax)} />
      {rows.map((row) => <circle key={row.id} className={selectedId === row.id ? "selected" : undefined} cx={xAt(row[xMetric])} cy={yAt(row[yMetric])} r={selectedId === row.id ? 7 : 5} role="button" tabIndex={0} aria-label={`${row.name} · ${configOf(xMetric, metricCopy).label} ${formatted(row[xMetric], xMetric)} · ${configOf(yMetric, metricCopy).label} ${formatted(row[yMetric], yMetric)}`} onClick={() => select(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(row); }} />)}
    </g>
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

export function ReportChart({ datasets, initialDimension, variant = "business", allowAxisEditor = false }: { datasets: ReportChartDataset[]; initialDimension?: string; variant?: ReportChartVariant; allowAxisEditor?: boolean }) {
  const customerBehavior = variant === "customer-behavior";
  const metricCopy = customerBehavior ? CUSTOMER_BEHAVIOR_METRICS : undefined;
  const available = datasets.filter((item) => item.rows.length);
  const [dimension, setDimension] = useState(initialDimension ?? available[0]?.key ?? datasets[0]?.key ?? "");
  const [mode, setMode] = useState<AnalysisMode>("business");
  const [chartType, setChartType] = useState<ChartType>(customerBehavior ? "bar" : "line");
  const [metrics, setMetrics] = useState<ReportMetric[]>(["gross"]);
  const [question, setQuestion] = useState(customerBehavior ? "customer-sales" : "sales-draw");
  const [axisEditorOpen, setAxisEditorOpen] = useState(false);
  const [scatterXMetric, setScatterXMetric] = useState<ReportMetric>("gross");
  const [scatterYMetric, setScatterYMetric] = useState<ReportMetric>("bills");
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
    setScatterXMetric((current) => allowedMetrics.includes(current) ? current : allowedMetrics[0] ?? "gross");
    setScatterYMetric((current) => allowedMetrics.includes(current) ? current : allowedMetrics.find((metric) => metric !== (allowedMetrics[0] ?? "gross")) ?? allowedMetrics[0] ?? "gross");
  }, [dataset?.key]);

  const totals = useMemo(() => dataset?.rows.reduce((sum, row) => ({ gross: sum.gross + row.gross, payout: sum.payout + row.payout, commission: sum.commission + row.commission, net: sum.net + row.net, bills: sum.bills + row.bills, items: sum.items + row.items, winners: sum.winners + row.winners }), { gross: 0, payout: 0, commission: 0, net: 0, bills: 0, items: 0, winners: 0 }), [dataset]);
  const primaryStats = statistics(dataset?.rows.map((row) => row[primary]) ?? []);
  const highest = dataset?.rows.reduce<ReportChartDatum | undefined>((top, row) => !top || Math.abs(row[primary]) > Math.abs(top[primary]) ? row : top, undefined);
  const select = (row: ReportChartDatum) => setSelectedId(row.id);

  function changeMode(next: string) {
    const nextMode = next as AnalysisMode;
    setMode(nextMode);
    setChartType(nextMode === "business" ? "bar" : "comparison");
    setMetrics([primary]);
  }

  function selectAxisMetric(metric: ReportMetric) {
    setMetrics([metric]);
  }

  function selectScatterX(metric: ReportMetric) {
    setScatterXMetric(metric);
    setMetrics(metric === scatterYMetric ? [metric] : [metric, scatterYMetric]);
  }

  function selectScatterY(metric: ReportMetric) {
    setScatterYMetric(metric);
    setMetrics(metric === scatterXMetric ? [scatterXMetric] : [scatterXMetric, metric]);
  }

  function selectBusinessChartType(next: string) {
    setChartType(next as ChartType);
  }
  function selectBusinessDimension(next: string) {
    setQuestion("custom");
    setDimension(next);
    if (chartType === "line" && next !== "draws" && next !== "timeline") setChartType("bar");
  }

  const metricOptions = allowedMetrics.map((metric) => ({ value: metric, label: configOf(metric, metricCopy).label, description: configOf(metric, metricCopy).description }));
  const dimensionOptions = datasets.map((item) => ({ value: item.key, label: item.label, description: item.description, badge: item.rows.length.toLocaleString("th-TH") }));
  const questions = (customerBehavior ? CUSTOMER_QUESTIONS : REPORT_QUESTIONS).filter((item) => datasets.some((entry) => entry.key === item.dimension && (entry.metrics?.includes(item.metric) ?? true)));
  function selectQuestion(value: string) {
    const preset = questions.find((item) => item.value === value);
    if (!preset) return;
    setQuestion(value);
    setDimension(preset.dimension);
    setMetrics([preset.metric]);
    setChartType(preset.chart);
    setAxisEditorOpen(false);
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

      <div className="chart-question-picker"><label><span>อยากรู้เรื่องอะไร</span><AppDropdown value={questions.some((item) => item.value === question) ? question : "custom"} onValueChange={selectQuestion} ariaLabel="เลือกคำถามที่อยากดู" options={[...questions.map((item) => ({ value: item.value, label: item.label })), { value: "custom", label: "กำหนดเอง", disabled: true }]} /></label><p>ระบบเลือกกราฟและแกนที่เหมาะกับคำถามให้ทันที · ใช้ข้อมูลจริง {dataset?.rows.length.toLocaleString("th-TH") ?? 0} รายการ</p>{allowAxisEditor && <button type="button" className="chart-axis-editor-toggle" aria-expanded={axisEditorOpen} onClick={() => setAxisEditorOpen((current) => !current)}>{axisEditorOpen ? "← กลับไปกราฟสำเร็จรูป" : "⚙ ปรับแกน X–Y เพิ่มเติม"}</button>}</div>
      {!axisEditorOpen && !allowAxisEditor && <details className="chart-manual-settings"><summary>ปรับรูปแบบกราฟและแกนเอง</summary><div className="chart-axis-builder" aria-label="เลือกข้อมูลสำหรับสร้างกราฟ">
        <div className="chart-axis-builder-heading"><span>1</span><div><strong>เลือกแกนของกราฟ</strong><small>เลือกแกน X และ Y ก่อน แล้วค่อยกำหนดช่วงค่าด้านล่าง</small></div></div>
        <div className="chart-axis-builder-grid">
          <label><span>รูปแบบกราฟ</span><AppDropdown value={chartType} onValueChange={(value) => { setQuestion("custom"); selectBusinessChartType(value); }} ariaLabel="เลือกรูปแบบกราฟ" options={businessChartOptions.map((item) => ({ ...item, disabled: item.value === "line" && dataset?.key !== "draws" && dataset?.key !== "timeline" }))} /></label>
          <label><span>แกน X · แบ่งข้อมูลตาม</span><AppDropdown value={dataset?.key} onValueChange={selectBusinessDimension} ariaLabel="เลือกแกน X" options={dimensionOptions} /></label>
          <label><span>แกน Y · ค่าที่ต้องการดู</span><AppDropdown value={primary} onValueChange={(value) => { setQuestion("custom"); selectAxisMetric(value as ReportMetric); }} ariaLabel="เลือกแกน Y" options={metricOptions} /></label>
        </div>
      </div></details>}

      {axisEditorOpen && allowAxisEditor && (customerBehavior
        ? <CustomerBehaviorChartBuilder key={question} datasets={datasets} initialDimension={dimension} />
        : <LazyCustomChartBuilder key={question} initialXMetric={primary} initialYMetric={primary === "bills" ? "gross" : "bills"} />)}

      {!axisEditorOpen && dataset && <div className="business-summary-strip"><span><small>{configOf(primary, metricCopy).label}รวม</small><strong className={(totals?.[primary] ?? 0) < 0 ? "negative" : undefined}>{formatted(totals?.[primary] ?? 0, primary)}</strong></span><span><small>ค่าเฉลี่ยต่อรายการ</small><strong>{formatted(primaryStats.mean, primary)}</strong></span><span><small>สูงสุด</small><strong>{highest ? formatted(highest[primary], primary) : "—"}</strong><em>{highest?.name ?? "ยังไม่มีข้อมูล"}</em></span><span className="business-row-count"><strong>{dataset.rows.length.toLocaleString("th-TH")}</strong><small>รายการที่นำมาวิเคราะห์</small></span></div>}

      {!axisEditorOpen && (!dataset || !dataset.rows.length ? <div className="report-empty">ยังไม่มีข้อมูลสำหรับสร้างกราฟ</div> : <div className="report-viz-workspace business-workspace"><div className="report-viz-canvas" data-chart={chartType}>
        <div className="business-chart-heading"><div><span>{dataset.label}</span><strong>{businessChartOptions.find((option) => option.value === chartType)?.label} · {configOf(primary, metricCopy).label}</strong></div><div>{selectedMetrics.map((metric) => <i key={metric}><u style={{ background: configOf(metric, metricCopy).color }} />{configOf(metric, metricCopy).label}</i>)}</div></div>
        {(chartType === "bar" || chartType === "line") && <ComparisonChart rows={dataset.rows} metrics={selectedMetrics} mode="business" type={chartType} selectedId={selected?.id} select={select} metricCopy={metricCopy} dimension={dataset.key} />}
        {chartType === "donut" && <DonutChart rows={dataset.rows} metric={primary} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
        {chartType === "table" && <DataTable rows={dataset.rows} metrics={selectedMetrics} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
        {selected && <div className="business-selected-row" aria-live="polite"><span><small>รายการที่เลือก</small><strong>{selected.code} · {selected.name}</strong></span><span><small>{configOf(primary, metricCopy).label}</small><strong className={selected[primary] < 0 ? "negative" : undefined}>{formatted(selected[primary], primary)}</strong></span><span><small>สัดส่วน</small><strong>{Math.abs(selected[primary]) && totals ? `${(Math.abs(selected[primary]) / Math.max(Math.abs(totals[primary]), 1) * 100).toFixed(1)}%` : "—"}</strong></span>{selected.href ? <a href={selected.href}>ดูรายละเอียด →</a> : <small>คลิกแท่งอื่นเพื่อเปลี่ยนรายการ</small>}</div>}
      </div></div>)}
    </section>;
  }

  return <section className="report-panel report-chart-panel report-visual-center advanced-analytics" aria-labelledby="performance-chart-heading">
    <div className="report-viz-heading"><div className="report-viz-title"><span className="report-viz-title-icon" aria-hidden="true">Σ</span><div><span className="report-kicker">{customerBehavior ? "CUSTOMER BEHAVIOR STATISTICS" : "ADVANCED STATISTICAL CHARTING"}</span><h2 id="performance-chart-heading">{customerBehavior ? "Customer Behavior Data Science" : "Business Analysis & Data Science"}</h2><p>{customerBehavior ? "วิเคราะห์ความสัมพันธ์ การกระจาย และรูปแบบการซื้อจากข้อมูลลูกค้าจริง" : "เลือกมุมมองและตัวชี้วัด แล้วระบบจะแสดงกราฟเพียงหนึ่งแบบเพื่อให้วิเคราะห์ได้ชัดเจน"}</p></div></div><span className="advanced-mode-badge is-engineer">Statistic Engineer</span></div>
    <div className="chart-axis-builder is-engineer" aria-label="เลือกข้อมูลสำหรับสร้างกราฟเชิงลึก">
      <div className="chart-axis-builder-heading"><span>1</span><div><strong>เลือกโมเดลและแกนของกราฟ</strong><small>ทุกค่าเลือกจาก Dropdown เดียวกัน จากนั้นกำหนดช่วงแกนในขั้นตอนถัดไป</small></div></div>
      <div className="chart-axis-builder-grid is-four-columns">
        <label><span>ระดับการวิเคราะห์</span><AppDropdown value={mode} onValueChange={changeMode} ariaLabel="เลือกระดับการวิเคราะห์" options={[{ value: "business", label: customerBehavior ? "Customer Overview — เข้าใจง่าย" : "Business Analysis — เข้าใจง่าย", description: customerBehavior ? "เหมาะสำหรับดูภาพรวมพฤติกรรมลูกค้า" : "เหมาะสำหรับดูภาพรวมและตัดสินใจ" }, { value: "engineer", label: "Statistic Engineer", description: "Z-score, Correlation, Regression และ Distribution" }]} /></label>
        <label><span>รูปแบบกราฟ</span><AppDropdown value={chartType} onValueChange={(value) => setChartType(value as ChartType)} ariaLabel="เลือกรูปแบบกราฟ" options={chartOptions} /></label>
        <label><span>แกน X · {chartType === "scatter" ? "ตัวแปรต้น" : "แบ่งข้อมูลตาม"}</span><AppDropdown value={chartType === "scatter" ? scatterXMetric : dataset?.key} onValueChange={(value) => chartType === "scatter" ? selectScatterX(value as ReportMetric) : setDimension(value)} ariaLabel="เลือกแกน X" options={chartType === "scatter" ? metricOptions : dimensionOptions} /></label>
        <label><span>แกน Y · ตัวแปรที่วิเคราะห์</span><AppDropdown value={chartType === "scatter" ? scatterYMetric : primary} onValueChange={(value) => chartType === "scatter" ? selectScatterY(value as ReportMetric) : selectAxisMetric(value as ReportMetric)} ariaLabel="เลือกแกน Y" options={metricOptions} /></label>
      </div>
    </div>
    <div className="advanced-analysis-note"><span aria-hidden="true">ⓘ</span><p>{chartDescription}</p></div>
    {dataset && <div className="report-viz-summary"><span><small>มุมมองปัจจุบัน</small><strong>{dataset.label}</strong><em>{dataset.rows.length.toLocaleString("th-TH")} รายการ</em></span><span><small>{configOf(primary, metricCopy).label}รวม</small><strong className={(totals?.[primary] ?? 0) < 0 ? "negative" : undefined}>{formatted(totals?.[primary] ?? 0, primary)}</strong><em>ตัวชี้วัดหลักที่เลือก</em></span><span><small>Mean / Median</small><strong>{COMPACT.format(primaryStats.mean)} / {COMPACT.format(primaryStats.median)}</strong><em>ค่าเฉลี่ยและค่ากลาง</em></span><span><small>ค่าสูงสุด</small><strong>{highest ? formatted(highest[primary], primary) : "—"}</strong><em>{highest?.name ?? "ยังไม่มีข้อมูล"}</em></span></div>}
    {!dataset || !dataset.rows.length ? <div className="report-empty">ยังไม่มีข้อมูลสำหรับสร้างกราฟ</div> : <div className="report-viz-workspace"><div className="report-viz-canvas" data-chart={chartType}><div className="report-viz-canvas-heading"><div><span>STATISTICAL MODEL</span><strong>{chartOptions.find((option) => option.value === chartType)?.label} · {dataset.label}</strong></div><small>{selectedMetrics.map((metric) => configOf(metric, metricCopy).label).join(" · ")}<br />คลิกจุดหรือแท่งเพื่อเจาะรายละเอียด</small></div>
      {(chartType === "bar" || chartType === "line" || chartType === "comparison") && <ComparisonChart rows={dataset.rows} metrics={selectedMetrics} mode={mode} type={chartType} selectedId={selected?.id} select={select} metricCopy={metricCopy} dimension={dataset.key} />}
      {chartType === "donut" && <DonutChart rows={dataset.rows} metric={primary} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
      {chartType === "scatter" && <ScatterChart rows={dataset.rows} xMetric={scatterXMetric} yMetric={scatterYMetric} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
      {chartType === "distribution" && <DistributionChart rows={dataset.rows} metrics={selectedMetrics} metricCopy={metricCopy} />}
      {chartType === "table" && <DataTable rows={dataset.rows} metrics={selectedMetrics} selectedId={selected?.id} select={select} metricCopy={metricCopy} />}
    </div>{selected && <aside className="report-drilldown" aria-live="polite"><div className="report-drilldown-title"><span>เจาะรายละเอียด</span><b>{selected.code}</b><h3>{selected.name}</h3></div><div className="report-drilldown-focus"><small>{configOf(primary, metricCopy).label}</small><strong className={selected[primary] < 0 ? "negative" : undefined}>{formatted(selected[primary], primary)}</strong><span>{Math.abs(selected[primary]) && totals ? `${(Math.abs(selected[primary]) / Math.max(Math.abs(totals[primary]), 1) * 100).toFixed(1)}% ของทั้งหมด` : "ยังไม่มีสัดส่วน"}</span></div><dl>{selectedMetrics.map((metric) => <div key={metric}><dt>{configOf(metric, metricCopy).label}</dt><dd className={selected[metric] < 0 ? "negative" : ""}>{formatted(selected[metric], metric)}</dd></div>)}</dl>{!customerBehavior && selected.gross !== 0 && <div className="report-drilldown-ratio"><span>อัตราจ่ายรางวัล</span><b>{(selected.payout / selected.gross * 100).toFixed(1)}%</b><i><u style={{ width: `${Math.min(Math.abs(selected.payout / selected.gross * 100), 100)}%` }} /></i></div>}{selected.href && <a href={selected.href}>ดูข้อมูลเจาะลึก →</a>}</aside>}</div>}
  </section>;
}

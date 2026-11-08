"use client";

import { useEffect, useMemo, useState } from "react";
import { AppDropdown } from "../AppDropdown";
import { ChartTypeSelector } from "../reports/ChartTypeSelector";
import { CHART_COLORS, type CustomChartKind } from "../reports/CustomChartTypes";
import type { ReportChartDataset, ReportChartDatum, ReportMetric } from "../reports/ReportChart";

type BehaviorMetric = Extract<ReportMetric, "gross" | "bills" | "items"> | "average";
type SortMode = "value-desc" | "value-asc" | "source";

type Settings = {
  kind: CustomChartKind;
  dimension: string;
  xMetric: BehaviorMetric;
  yMetric: BehaviorMetric;
  top: "6" | "12" | "24" | "all";
  sort: SortMode;
  color: string;
  showLegend: boolean;
  showLabels: boolean;
  showGrid: boolean;
  min: string;
  max: string;
};

const STORAGE_KEY = "lottery-customer-behavior-chart-v1";
const NUMBER = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });

const METRICS: Array<{ value: BehaviorMetric; label: string; description: string; money: boolean }> = [
  { value: "gross", label: "ยอดซื้อ", description: "มูลค่าที่ลูกค้าซื้อรวม", money: true },
  { value: "bills", label: "ความถี่ซื้อ", description: "จำนวนบิลหรือจำนวนครั้งที่ซื้อ", money: false },
  { value: "items", label: "จำนวนเลขที่เลือก", description: "จำนวนรายการเลขที่ลูกค้าเลือก", money: false },
  { value: "average", label: "ยอดซื้อต่อครั้ง", description: "ยอดซื้อเฉลี่ยต่อหนึ่งบิล", money: true },
];

function metricMeta(metric: BehaviorMetric) { return METRICS.find((item) => item.value === metric)!; }
function valueOf(row: ReportChartDatum, metric: BehaviorMetric) { return metric === "average" ? row.gross / Math.max(row.bills, 1) : row[metric]; }
function format(value: number, metric: BehaviorMetric, compact = false) { const meta = metricMeta(metric); return `${compact ? COMPACT.format(value) : meta.money ? MONEY.format(value) : NUMBER.format(value)}${meta.money ? " บาท" : ""}`; }
function defaultSettings(dimension: string): Settings { return { kind: "bar", dimension, xMetric: "gross", yMetric: "gross", top: "12", sort: "value-desc", color: CHART_COLORS[0], showLegend: true, showLabels: false, showGrid: true, min: "", max: "" }; }

function arcPath(start: number, end: number, inner: number) {
  const angle = (portion: number) => portion * Math.PI * 2 - Math.PI / 2;
  const point = (portion: number, radius: number) => [170 + Math.cos(angle(portion)) * radius, 170 + Math.sin(angle(portion)) * radius];
  const outerA = point(start, 122), outerB = point(end, 122), innerA = point(start, inner), innerB = point(end, inner);
  const large = end - start > .5 ? 1 : 0;
  return inner ? `M ${outerA} A 122 122 0 ${large} 1 ${outerB} L ${innerB} A ${inner} ${inner} 0 ${large} 0 ${innerA} Z` : `M 170 170 L ${outerA} A 122 122 0 ${large} 1 ${outerB} Z`;
}

function BehaviorPreview({ dataset, settings }: { dataset: ReportChartDataset; settings: Settings }) {
  const [hover, setHover] = useState<{ title: string; lines: string[] } | null>(null);
  const rows = useMemo(() => {
    const result = [...dataset.rows];
    if (settings.sort === "value-desc") result.sort((a, b) => valueOf(b, settings.yMetric) - valueOf(a, settings.yMetric));
    if (settings.sort === "value-asc") result.sort((a, b) => valueOf(a, settings.yMetric) - valueOf(b, settings.yMetric));
    return settings.top === "all" ? result.slice(0, 50) : result.slice(0, Number(settings.top));
  }, [dataset, settings.sort, settings.top, settings.yMetric]);
  const yMeta = metricMeta(settings.yMetric);
  const title = `${yMeta.label} · ${dataset.label}`;
  const tooltip = hover && <div className="custom-preview-tooltip behavior-preview-tooltip" role="tooltip"><strong>{hover.title}</strong>{hover.lines.map((line) => <span key={line}>{line}</span>)}</div>;
  if (!rows.length) return <div className="custom-preview-empty"><strong>ยังไม่มีข้อมูลพฤติกรรมสำหรับสร้างกราฟ</strong><small>ลองเปลี่ยนตัวกรองงวด, Agent หรือสถานะด้านบน</small></div>;

  if (settings.kind === "pie" || settings.kind === "donut") {
    const ranked = rows.filter((row) => valueOf(row, settings.yMetric) > 0).sort((a, b) => valueOf(b, settings.yMetric) - valueOf(a, settings.yMetric));
    const top = ranked.slice(0, 6);
    const otherValue = ranked.slice(6).reduce((sum, row) => sum + valueOf(row, settings.yMetric), 0);
    const values = [...top.map((row) => ({ id: row.id, label: row.name, value: valueOf(row, settings.yMetric) })), ...(otherValue ? [{ id: "other", label: `อื่น ๆ (${ranked.length - 6} รายการ)`, value: otherValue }] : [])];
    const total = Math.max(values.reduce((sum, row) => sum + row.value, 0), 1);
    let offset = 0;
    return <section className="custom-preview-shell behavior-preview"><header><div><span>LIVE PREVIEW · CUSTOMER BEHAVIOR</span><h3>{title}</h3><p>สัดส่วนจากข้อมูลพฤติกรรมที่ผ่านตัวกรอง</p></div><small>{dataset.rows.length.toLocaleString("th-TH")} รายการ</small></header>{tooltip}<div className="custom-preview-pie"><svg viewBox="0 0 340 340" role="img" aria-label={title}>{values.map((row, index) => { const start = offset; offset += row.value / total; return <path key={row.id} d={arcPath(start, offset, settings.kind === "donut" ? 72 : 0)} fill={CHART_COLORS[index % CHART_COLORS.length]} tabIndex={0} onMouseEnter={() => setHover({ title: row.label, lines: [format(row.value, settings.yMetric), `${(row.value / total * 100).toFixed(1)}%`] })} onMouseLeave={() => setHover(null)} />; })}{settings.kind === "donut" && <><text x="170" y="164" textAnchor="middle" className="custom-preview-donut-total">{format(total, settings.yMetric, true)}</text><text x="170" y="188" textAnchor="middle">รวม</text></>}</svg><div className="custom-preview-legend">{values.map((row, index) => <div key={row.id}><i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span><b>{row.label}</b><small>{format(row.value, settings.yMetric)}</small></span><strong>{(row.value / total * 100).toFixed(1)}%</strong></div>)}</div></div></section>;
  }

  if (settings.kind === "horizontal-bar") {
    const maximum = Math.max(...rows.map((row) => Math.abs(valueOf(row, settings.yMetric))), 1);
    return <section className="custom-preview-shell behavior-preview"><header><div><span>LIVE PREVIEW · CUSTOMER BEHAVIOR</span><h3>{title}</h3><p>เรียงอันดับให้อ่านชื่อและค่าพฤติกรรมได้ชัดเจน</p></div><small>{rows.length} อันดับ</small></header>{tooltip}<div className="custom-preview-horizontal">{rows.map((row, index) => <button type="button" key={row.id} onMouseEnter={() => setHover({ title: row.name, lines: [format(valueOf(row, settings.yMetric), settings.yMetric)] })} onMouseLeave={() => setHover(null)}><span>{index + 1}</span><b>{row.name}</b><i><u style={{ width: `${Math.max(2, Math.abs(valueOf(row, settings.yMetric)) / maximum * 100)}%`, background: settings.color }} /></i><strong>{format(valueOf(row, settings.yMetric), settings.yMetric, true)}</strong></button>)}</div></section>;
  }

  const width = 940, left = 86, right = 850, top = 34, bottom = 306;
  const yValues = rows.map((row) => valueOf(row, settings.yMetric));
  const rawMin = settings.min !== "" && Number.isFinite(Number(settings.min)) ? Number(settings.min) : Math.min(0, ...yValues);
  const rawMax = settings.max !== "" && Number.isFinite(Number(settings.max)) ? Number(settings.max) : Math.max(1, ...yValues);
  const yMin = Math.min(rawMin, rawMax - 1), yMax = Math.max(rawMax, yMin + 1), yRange = yMax - yMin;
  const step = (right - left) / Math.max(rows.length, 1);
  const xAt = (index: number) => left + step * (index + .5);
  const yAt = (value: number) => bottom - (value - yMin) / yRange * (bottom - top);
  const zero = yAt(Math.max(yMin, Math.min(yMax, 0)));

  if (settings.kind === "scatter") {
    const xValues = rows.map((row) => valueOf(row, settings.xMetric));
    const xMin = Math.min(0, ...xValues), xMax = Math.max(1, ...xValues), xRange = Math.max(xMax - xMin, 1);
    const scatterX = (value: number) => left + (value - xMin) / xRange * (right - left);
    return <section className="custom-preview-shell behavior-preview"><header><div><span>LIVE PREVIEW · CUSTOMER BEHAVIOR</span><h3>{metricMeta(settings.xMetric).label} เทียบ {yMeta.label}</h3><p>แต่ละจุดคือหนึ่งรายการในมิติ “{dataset.label}”</p></div><small>{rows.length} จุดข้อมูล</small></header>{tooltip}<div className="custom-preview-chart-scroll"><svg className="custom-preview-svg" viewBox={`0 0 ${width} 380`} role="img" aria-label={title}>{[0,1,2,3,4].map((tick) => <g key={tick}>{settings.showGrid && <><line x1={left} x2={right} y1={top + tick * 68} y2={top + tick * 68} className="custom-preview-gridline" /><line x1={left + tick * 191} x2={left + tick * 191} y1={top} y2={bottom} className="custom-preview-gridline" /></>}<text x={left - 9} y={top + tick * 68 + 4} textAnchor="end">{format(yMax - tick / 4 * yRange, settings.yMetric, true)}</text><text x={left + tick * 191} y="332" textAnchor="middle">{format(xMin + tick / 4 * xRange, settings.xMetric, true)}</text></g>)}{rows.map((row) => <circle key={row.id} cx={scatterX(valueOf(row, settings.xMetric))} cy={yAt(valueOf(row, settings.yMetric))} r="6" fill={settings.color} opacity=".74" stroke="#fff" strokeWidth="2" tabIndex={0} onMouseEnter={() => setHover({ title: row.name, lines: [`${metricMeta(settings.xMetric).label}: ${format(valueOf(row, settings.xMetric), settings.xMetric)}`, `${yMeta.label}: ${format(valueOf(row, settings.yMetric), settings.yMetric)}`] })} onMouseLeave={() => setHover(null)} />)}<text x="468" y="372" textAnchor="middle" className="custom-preview-axis-title">{metricMeta(settings.xMetric).label}</text><text x="18" y="170" transform="rotate(-90 18 170)" textAnchor="middle" className="custom-preview-axis-title">{yMeta.label}</text></svg></div></section>;
  }

  const line = rows.map((row, index) => `${index ? "L" : "M"}${xAt(index)} ${yAt(valueOf(row, settings.yMetric))}`).join(" ");
  const secondaryMetric: BehaviorMetric = settings.yMetric === "bills" ? "gross" : "bills";
  const secondaryMax = Math.max(...rows.map((row) => valueOf(row, secondaryMetric)), 1);
  const axisTitle = settings.kind === "stacked" ? "ดัชนีเปรียบเทียบ (แต่ละชุดสูงสุด = 100)" : yMeta.label;
  return <section className="custom-preview-shell behavior-preview"><header><div><span>LIVE PREVIEW · CUSTOMER BEHAVIOR</span><h3>{title}</h3><p>{dataset.description}</p></div><small>{rows.length} กลุ่มข้อมูล</small></header>{tooltip}{settings.showLegend && <div className="custom-preview-series-legend"><span><i style={{ background: settings.color }} />{yMeta.label}</span>{(settings.kind === "combo" || settings.kind === "stacked") && <span><i style={{ background: CHART_COLORS[1] }} />{metricMeta(secondaryMetric).label}</span>}{settings.kind === "stacked" && <small>กราฟแท่งซ้อนใช้ดัชนีเทียบค่าสูงสุดของแต่ละชุด = 100 เพื่อไม่รวมคนละหน่วยโดยตรง</small>}</div>}<div className="custom-preview-chart-scroll"><svg className="custom-preview-svg" viewBox={`0 0 ${width} 380`} role="img" aria-label={title}>{[0,1,2,3,4].map((tick) => <g key={tick}>{settings.showGrid && <line x1={left} x2={right} y1={top + tick * 68} y2={top + tick * 68} className="custom-preview-gridline" />}<text x={left - 9} y={top + tick * 68 + 4} textAnchor="end">{settings.kind === "stacked" ? 200 - tick * 50 : format(yMax - tick / 4 * yRange, settings.yMetric, true)}</text></g>)}{settings.kind === "area" && <path d={`${line} L ${xAt(rows.length - 1)} ${zero} L ${xAt(0)} ${zero} Z`} fill={settings.color} opacity=".16" />}{(settings.kind === "line" || settings.kind === "area") && <path d={line} fill="none" stroke={settings.color} strokeWidth="3" />}{settings.kind === "bar" && rows.map((row, index) => <rect key={row.id} x={xAt(index) - Math.min(25, step * .33)} y={Math.min(zero, yAt(valueOf(row, settings.yMetric)))} width={Math.min(50, step * .66)} height={Math.max(2, Math.abs(zero - yAt(valueOf(row, settings.yMetric))))} rx="5" fill={settings.color} onMouseEnter={() => setHover({ title: row.name, lines: [format(valueOf(row, settings.yMetric), settings.yMetric)] })} onMouseLeave={() => setHover(null)} />)}{settings.kind === "stacked" && rows.map((row, index) => { const first = valueOf(row, settings.yMetric) / Math.max(...rows.map((item) => valueOf(item, settings.yMetric)), 1) * 100; const second = valueOf(row, secondaryMetric) / secondaryMax * 100; const scale = 250 / 200; return <g key={row.id}><rect x={xAt(index) - Math.min(25, step * .33)} y={bottom - first * scale} width={Math.min(50, step * .66)} height={first * scale} fill={settings.color} /><rect x={xAt(index) - Math.min(25, step * .33)} y={bottom - (first + second) * scale} width={Math.min(50, step * .66)} height={second * scale} fill={CHART_COLORS[1]} /></g>; })}{settings.kind === "combo" && <>{rows.map((row, index) => <rect key={row.id} x={xAt(index) - Math.min(24, step * .3)} y={yAt(valueOf(row, settings.yMetric))} width={Math.min(48, step * .6)} height={Math.max(2, bottom - yAt(valueOf(row, settings.yMetric)))} rx="4" fill={settings.color} opacity=".72" />)}<polyline points={rows.map((row, index) => `${xAt(index)},${bottom - valueOf(row, secondaryMetric) / secondaryMax * (bottom - top)}`).join(" ")} fill="none" stroke={CHART_COLORS[1]} strokeWidth="3" /></>}{(settings.kind === "line" || settings.kind === "area" || settings.kind === "combo") && rows.map((row, index) => <circle key={row.id} cx={xAt(index)} cy={settings.kind === "combo" ? bottom - valueOf(row, secondaryMetric) / secondaryMax * (bottom - top) : yAt(valueOf(row, settings.yMetric))} r="5" fill={settings.kind === "combo" ? CHART_COLORS[1] : settings.color} stroke="#fff" strokeWidth="2" onMouseEnter={() => setHover({ title: row.name, lines: [format(valueOf(row, settings.yMetric), settings.yMetric)] })} onMouseLeave={() => setHover(null)} />)}{settings.showLabels && settings.kind !== "stacked" && rows.map((row, index) => <text key={row.id} x={xAt(index)} y={Math.max(18, yAt(valueOf(row, settings.yMetric)) - 9)} textAnchor="middle" className="custom-preview-data-label">{format(valueOf(row, settings.yMetric), settings.yMetric, true)}</text>)}{rows.map((row, index) => (index % Math.max(1, Math.ceil(rows.length / 7)) === 0 || index === rows.length - 1) && <text key={row.id} x={xAt(index)} y="332" textAnchor="middle">{row.code.length > 13 ? `${row.code.slice(0, 12)}…` : row.code}</text>)}<text x="468" y="372" textAnchor="middle" className="custom-preview-axis-title">{dataset.label}</text><text x="18" y="170" transform="rotate(-90 18 170)" textAnchor="middle" className="custom-preview-axis-title">{axisTitle}</text></svg></div></section>;
}

export function CustomerBehaviorChartBuilder({ datasets, initialDimension }: { datasets: ReportChartDataset[]; initialDimension?: string }) {
  const available = datasets.filter((dataset) => dataset.rows.length);
  const firstDimension = initialDimension && available.some((item) => item.key === initialDimension) ? initialDimension : available[0]?.key ?? datasets[0]?.key ?? "";
  const [settings, setSettings] = useState<Settings>(() => defaultSettings(firstDimension));
  const [saved, setSaved] = useState("");
  const dataset = datasets.find((item) => item.key === settings.dimension) ?? available[0] ?? datasets[0];
  const allowedMetrics = useMemo(() => {
    const metrics = (dataset?.metrics ?? ["gross", "bills", "items"]).filter((metric): metric is "gross" | "bills" | "items" => metric === "gross" || metric === "bills" || metric === "items");
    return [...metrics, ...(metrics.includes("gross") && metrics.includes("bills") ? ["average" as const] : [])];
  }, [dataset]);

  useEffect(() => {
    try { const raw = localStorage.getItem(STORAGE_KEY); if (raw) setSettings({ ...defaultSettings(firstDimension), ...(JSON.parse(raw) as Settings) }); } catch { /* ใช้ค่าเริ่มต้นเมื่อข้อมูลเดิมไม่สมบูรณ์ */ }
  }, [firstDimension]);

  useEffect(() => {
    if (!allowedMetrics.includes(settings.yMetric)) setSettings((current) => ({ ...current, yMetric: allowedMetrics[0] ?? "gross" }));
    if (!allowedMetrics.includes(settings.xMetric)) setSettings((current) => ({ ...current, xMetric: allowedMetrics.find((metric) => metric !== current.yMetric) ?? allowedMetrics[0] ?? "gross" }));
  }, [allowedMetrics, settings.xMetric, settings.yMetric]);

  if (!dataset) return <div className="custom-preview-empty">ยังไม่มีข้อมูลพฤติกรรมลูกค้า</div>;
  const rangeValid = (settings.min === "" || Number.isFinite(Number(settings.min))) && (settings.max === "" || Number.isFinite(Number(settings.max))) && (settings.min === "" || settings.max === "" || Number(settings.max) > Number(settings.min));
  const update = (next: Partial<Settings>) => { setSaved(""); setSettings((current) => ({ ...current, ...next })); };
  const changeKind = (kind: CustomChartKind) => update({ kind, ...(kind === "pie" || kind === "donut" ? { sort: "value-desc" as const } : {}), ...(kind === "scatter" && settings.xMetric === settings.yMetric ? { xMetric: allowedMetrics.find((metric) => metric !== settings.yMetric) ?? "gross" } : {}) });
  const reset = () => { setSettings(defaultSettings(firstDimension)); setSaved(""); };
  const save = () => { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); setSaved("บันทึกมุมมองพฤติกรรมลูกค้าแล้ว"); };

  return <section className="custom-chart-builder custom-chart-builder--guided behavior-chart-builder" aria-labelledby="behavior-chart-builder-heading">
    <header className="custom-chart-guided-header"><div><span>CUSTOMER BEHAVIOR CHART BUILDER</span><h2 id="behavior-chart-builder-heading">สร้างกราฟพฤติกรรมลูกค้า</h2><p>เลือกคำถามและข้อมูลทีละขั้น ระบบแสดง Preview จากข้อมูลลูกค้าจริงทันที</p></div><div className="custom-chart-guided-summary"><strong>{dataset.label}</strong><span>{settings.kind === "scatter" ? `${metricMeta(settings.xMetric).label} → ` : ""}{metricMeta(settings.yMetric).label}</span><small>{dataset.rows.length.toLocaleString("th-TH")} รายการพฤติกรรม</small></div></header>
    <nav className="chart-step-nav" aria-label="ขั้นตอนสร้างกราฟพฤติกรรม"><span className="is-active"><b>1</b>รูปแบบ</span><i /><span className="is-active"><b>2</b>ข้อมูลพฤติกรรม</span><i /><span><b>3</b>การแสดงผล</span></nav>
    <ChartTypeSelector value={settings.kind} onChange={changeKind} context="customer" />
    <section className="chart-settings-step" aria-labelledby="behavior-data-step"><header className="chart-settings-step-heading"><span>2</span><div><h3 id="behavior-data-step">เลือกข้อมูลพฤติกรรมลูกค้า</h3><p>มีเฉพาะข้อมูลลูกค้าและการซื้อ ไม่มีค่าจ่ายรางวัล คอมมิชชัน หรือยอดสุทธิ</p></div></header><div className="behavior-data-scope"><label><span>อยากวิเคราะห์เรื่อง</span><AppDropdown value={settings.dimension} onValueChange={(dimension) => { const next = datasets.find((item) => item.key === dimension); const nextMetrics = next?.metrics?.filter((metric) => metric === "gross" || metric === "bills" || metric === "items") ?? []; const keepMetric = settings.yMetric !== "average" && nextMetrics.some((metric) => metric === settings.yMetric); update({ dimension, yMetric: keepMetric ? settings.yMetric : (nextMetrics[0] as BehaviorMetric | undefined) ?? "gross" }); }} ariaLabel="เลือกข้อมูลพฤติกรรม" options={datasets.map((item) => ({ value: item.key, label: item.label, description: item.description, badge: item.rows.length.toLocaleString("th-TH"), disabled: !item.rows.length }))} /></label></div><div className="chart-axis-panels"><section className="chart-axis-panel chart-axis-panel--x"><header><span>X</span><div><h4>แกน X</h4><p>{settings.kind === "scatter" ? "ค่าพฤติกรรมที่ใช้หาความสัมพันธ์" : "หมวดหมู่ที่ใช้แบ่งข้อมูล"}</p></div></header><div className="chart-axis-panel-fields">{settings.kind === "scatter" ? <label><span>ข้อมูลที่ใช้</span><AppDropdown value={settings.xMetric} onValueChange={(value) => update({ xMetric: value as BehaviorMetric })} ariaLabel="ข้อมูลพฤติกรรมแกน X" options={allowedMetrics.map((metric) => ({ value: metric, label: metricMeta(metric).label, description: metricMeta(metric).description }))} /></label> : <div className="behavior-fixed-axis"><strong>{dataset.label}</strong><small>{dataset.description}</small></div>}</div></section><section className="chart-axis-panel chart-axis-panel--y"><header><span>Y</span><div><h4>แกน Y</h4><p>ค่าพฤติกรรมที่ต้องการวัด</p></div></header><div className="chart-axis-panel-fields"><label><span>ข้อมูลที่ใช้</span><AppDropdown value={settings.yMetric} onValueChange={(value) => update({ yMetric: value as BehaviorMetric })} ariaLabel="ข้อมูลพฤติกรรมแกน Y" options={allowedMetrics.map((metric) => ({ value: metric, label: metricMeta(metric).label, description: metricMeta(metric).description }))} /></label><details className="chart-axis-range"><summary>กำหนดช่วงแกน</summary><div className="chart-axis-minmax"><label><span>Min</span><input type="number" inputMode="decimal" value={settings.min} placeholder="อัตโนมัติ" onChange={(event) => update({ min: event.target.value })} /></label><label><span>Max</span><input type="number" inputMode="decimal" value={settings.max} placeholder="อัตโนมัติ" onChange={(event) => update({ max: event.target.value })} /></label></div></details></div></section></div></section>
    <section className="chart-settings-step" aria-labelledby="behavior-display-step"><header className="chart-settings-step-heading"><span>3</span><div><h3 id="behavior-display-step">กำหนดขอบเขตและการแสดงผล</h3><p>ตัวกรองงวด Agent และสถานะด้านบนยังมีผลกับข้อมูลทุกกราฟ</p></div></header><div className="behavior-display-grid"><label><span>จำนวนที่แสดง</span><AppDropdown value={settings.top} onValueChange={(top) => update({ top: top as Settings["top"] })} ariaLabel="จำนวนข้อมูลพฤติกรรมที่แสดง" options={[{ value: "6", label: "6 อันดับ" }, { value: "12", label: "12 อันดับ" }, { value: "24", label: "24 อันดับ" }, { value: "all", label: "ทั้งหมด (สูงสุด 50)" }]} /></label><label><span>การเรียงลำดับ</span><AppDropdown value={settings.sort} onValueChange={(sort) => update({ sort: sort as SortMode })} ariaLabel="เรียงข้อมูลพฤติกรรม" options={[{ value: "value-desc", label: "ค่ามาก → น้อย" }, { value: "value-asc", label: "ค่าน้อย → มาก" }, { value: "source", label: "ตามลำดับข้อมูลเดิม" }]} /></label><fieldset className="chart-color-picker"><legend>สีหลัก</legend>{CHART_COLORS.map((color) => <button key={color} type="button" style={{ background: color }} aria-label={`เลือกสี ${color}`} aria-pressed={settings.color === color} onClick={() => update({ color })} />)}</fieldset><div className="chart-display-toggles"><label><input type="checkbox" checked={settings.showLegend} onChange={(event) => update({ showLegend: event.target.checked })} />คำอธิบายสี</label><label><input type="checkbox" checked={settings.showLabels} onChange={(event) => update({ showLabels: event.target.checked })} />ตัวเลขบนกราฟ</label><label><input type="checkbox" checked={settings.showGrid} onChange={(event) => update({ showGrid: event.target.checked })} />เส้นตาราง</label></div></div></section>
    {!rangeValid && <p className="custom-chart-error" role="alert">ค่า Max ต้องมากกว่า Min</p>}
    <BehaviorPreview dataset={dataset} settings={settings} />
    <footer className="custom-chart-guided-actions"><div>{saved && <span role="status">✓ {saved}</span>}</div><button type="button" onClick={reset}>คืนค่าเริ่มต้น</button><button type="button" className="custom-chart-save" disabled={!rangeValid} onClick={save}>บันทึกการตั้งค่า</button></footer>
  </section>;
}

"use client";

import { useState } from "react";
import type { ChartMatrixCell } from "./CustomChartBuilder";
import type { ReportChartDatum, ReportMetric } from "./ReportChart";

export type DashboardChartKind = "line" | "bar" | "stacked" | "area" | "donut" | "pie" | "scatter" | "combo";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("th-TH");
const SHORT = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });
const COLORS = ["#1677ff", "#16a6a0", "#f0a31a", "#7957d5", "#e65d73", "#6b8eb9"] as const;
const METRIC_LABEL: Record<ReportMetric, string> = { gross: "ยอดขาย", payout: "จ่ายรางวัล", commission: "คอมมิชชัน", net: "ยอดสุทธิ", bills: "จำนวนบิล", items: "จำนวนรายการ", winners: "รายการถูกรางวัล" };
const isMoney = (metric: ReportMetric) => !["bills", "items", "winners"].includes(metric);
const valueLabel = (value: number, metric: ReportMetric) => `${isMoney(metric) ? MONEY.format(value) : COUNT.format(value)}${isMoney(metric) ? " บาท" : ""}`;

export function ReportsDashboardChart({ kind, rows, metric, dimension, cells, showGrid, showLegend, min, max, onSelect, metricLabels, dimensionLabel, entityLabel = "Agent", rowSelection = "last" }: {
  kind: DashboardChartKind;
  rows: ReportChartDatum[];
  metric: ReportMetric;
  dimension: "draws" | "agents" | "prizes";
  cells?: ChartMatrixCell[];
  showGrid: boolean;
  showLegend: boolean;
  min?: number;
  max?: number;
  onSelect: (row: ReportChartDatum) => void;
  metricLabels?: Partial<Record<ReportMetric, string>>;
  dimensionLabel?: string;
  entityLabel?: string;
  rowSelection?: "first" | "last";
}) {
  const [hidden, setHidden] = useState<string[]>([]);
  const [hover, setHover] = useState<{ name: string; value: string } | null>(null);
  const visible = rowSelection === "first" ? rows.slice(0, 12) : rows.slice(-12);
  const labelOf = (value: ReportMetric) => metricLabels?.[value] ?? METRIC_LABEL[value];
  const resolvedDimensionLabel = dimensionLabel ?? (dimension === "draws" ? "งวด" : dimension === "agents" ? "Agent" : "ประเภทรางวัล");
  if (!visible.length) return <div className="report-dashboard-empty">ยังไม่มีข้อมูลในช่วงที่เลือก ลองเปลี่ยนงวดหรือช่วงเวลา</div>;

  const toggle = (key: string) => setHidden((items) => items.includes(key) ? items.filter((item) => item !== key) : [...items, key]);
  const legend = (items: { key: string; label: string; color: string }[]) => showLegend && <div className="report-dashboard-legend" aria-label="เลือกชุดข้อมูลที่แสดง">{items.map((item) => <button key={item.key} type="button" aria-pressed={!hidden.includes(item.key)} onClick={() => toggle(item.key)}><i style={{ background: item.color }} />{item.label}</button>)}</div>;

  if (kind === "donut" || kind === "pie") {
    const ranked = [...rows].filter((row) => row[metric] > 0).sort((a, b) => b[metric] - a[metric]);
    const top = ranked.slice(0, 5);
    const rest = ranked.slice(5).reduce((sum, row) => sum + row[metric], 0);
    const extraCount = Math.max(0, ranked.length - top.length);
    const segments = [...top.map((row) => ({ id: row.id, name: row.name, value: row[metric], row })), ...(rest ? [{ id: "other", name: "อื่น ๆ", value: rest, row: undefined }] : [])];
    const total = segments.reduce((sum, item) => sum + item.value, 0);
    if (!total) return <div className="report-dashboard-empty">ยังไม่มีค่าบวกสำหรับแสดงสัดส่วน</div>;
    let offset = 0;
    return <div className={`report-dashboard-share${showLegend ? "" : " report-dashboard-share--solo"}`}>
      {hover && <div className="report-dashboard-hover" role="tooltip"><b>{hover.name}</b><span>{hover.value}</span></div>}
      <svg viewBox="0 0 320 320" role="img" aria-label={`สัดส่วน${labelOf(metric)}`}>
        {segments.map((item, index) => { const start = offset; const fraction = item.value / total; offset += fraction; const end = offset; const angle = (portion: number) => portion * Math.PI * 2 - Math.PI / 2; const point = (portion: number, radius: number) => [160 + Math.cos(angle(portion)) * radius, 160 + Math.sin(angle(portion)) * radius]; const large = fraction > .5 ? 1 : 0; const outerA = point(start, 118), outerB = point(end, 118), innerA = point(start, kind === "donut" ? 69 : 0), innerB = point(end, kind === "donut" ? 69 : 0); const path = kind === "donut" ? `M ${outerA} A 118 118 0 ${large} 1 ${outerB} L ${innerB} A 69 69 0 ${large} 0 ${innerA} Z` : `M 160 160 L ${outerA} A 118 118 0 ${large} 1 ${outerB} Z`; return <path key={item.id} d={path} fill={hidden.includes(item.id) ? "#d9e4ef" : COLORS[index]} className="report-dashboard-chart-target" tabIndex={item.row ? 0 : undefined} role={item.row ? "button" : undefined} aria-label={`${item.name}: ${valueLabel(item.value, metric)} · ${(fraction * 100).toFixed(1)}%`} onMouseEnter={() => setHover({ name: item.name, value: `${valueLabel(item.value, metric)} · ${(fraction * 100).toFixed(1)}%` })} onMouseLeave={() => setHover(null)} onClick={() => item.row && onSelect(item.row)} onKeyDown={(event) => { if (item.row && (event.key === "Enter" || event.key === " ")) onSelect(item.row); }}></path>; })}
        {kind === "donut" && <><text x="160" y="153" textAnchor="middle" className="report-dashboard-donut-total">{SHORT.format(total)}</text><text x="160" y="175" textAnchor="middle" className="report-dashboard-donut-caption">{labelOf(metric)}</text></>}
      </svg>
      {showLegend && <div className="report-dashboard-share-legend">
        <div className="report-dashboard-share-total"><span>{labelOf(metric)}รวม</span><strong>{valueLabel(total, metric)}</strong><small>5 อันดับแรก และยอดรวมของรายการที่เหลือ</small></div>
        <div className="report-dashboard-share-list">{segments.map((item, index) => <button type="button" key={item.id} className={item.id === "other" ? "is-other" : undefined} aria-pressed={!hidden.includes(item.id)} onClick={() => toggle(item.id)}><i style={{ background: COLORS[index], borderLeftColor: COLORS[index] }} /><span className="report-dashboard-share-copy"><b>{item.name}</b><small>{valueLabel(item.value, metric)}{item.id === "other" ? ` · รวม ${extraCount} ${entityLabel}` : ""}</small></span><strong>{(item.value / total * 100).toFixed(1)}%</strong></button>)}</div>
        <p className="report-dashboard-share-help">กดชื่อรายการเพื่อซ่อนหรือแสดงส่วนนั้นในกราฟ</p>
      </div>}
    </div>;
  }

  const width = 900, left = 75, right = 825, top = 22, bottom = 272;
  const x = (index: number) => left + (index + .5) * (right - left) / visible.length;
  const values = visible.map((row) => row[metric]);
  const stackedAgents = kind === "stacked" && cells ? [...new Set(cells.filter((cell) => visible.some((row) => row.id === cell.drawId)).map((cell) => cell.agentId))].map((id) => { const code = cells.find((cell) => cell.agentId === id)?.agentCode ?? id; return { id, name: code.startsWith("SELF-") ? "เจ้าของกิจการ" : code, total: cells.filter((cell) => cell.agentId === id).reduce((sum, cell) => sum + cell.gross, 0) }; }).sort((a, b) => b.total - a.total).slice(0, 5) : [];
  const stackValues = visible.map((row) => cells?.filter((cell) => cell.drawId === row.id).reduce((sum, cell) => sum + cell.gross, 0) ?? 0);
  const axisValues = kind === "stacked" ? stackValues : values;
  const dataMin = Math.min(0, ...axisValues);
  const dataMax = Math.max(1, ...axisValues);
  const low = min ?? dataMin;
  const high = max ?? Math.max(dataMax * 1.08, 1);
  const span = Math.max(high - low, 1);
  const y = (value: number) => bottom - (value - low) / span * (bottom - top);
  const zero = Math.max(top, Math.min(bottom, y(0)));
  const xLabel = (row: ReportChartDatum) => row.code.length > 12 ? row.code.slice(0, 11) : row.code;

  if (kind === "scatter") {
    const xMax = Math.max(...visible.map((row) => row.gross), 1) * 1.1;
    const yMax = Math.max(...visible.map((row) => row.bills), 1) * 1.1;
    return <>{legend([{ key: "scatter", label: `${resolvedDimensionLabel} · ${labelOf("gross")}เทียบ${labelOf("bills")}`, color: COLORS[0] }])}{hover && <div className="report-dashboard-hover" role="tooltip"><b>{hover.name}</b><span>{hover.value}</span></div>}<div className="report-dashboard-chart-scroll"><svg className="report-dashboard-svg" viewBox="0 0 900 330" role="img" aria-label={`กราฟกระจาย${labelOf("gross")}เทียบ${labelOf("bills")}ของ${resolvedDimensionLabel}`}>
      {[0, 1, 2, 3, 4].map((step) => <g key={step}>{showGrid && <line x1={left} x2={right} y1={top + step * (bottom - top) / 4} y2={top + step * (bottom - top) / 4} className="report-dashboard-gridline" />}<text x={left - 10} y={top + step * (bottom - top) / 4 + 4} textAnchor="end">{SHORT.format(yMax * (1 - step / 4))}</text><text x={left + step * (right - left) / 4} y="296" textAnchor="middle">{SHORT.format(xMax * step / 4)}</text></g>)}
      {!hidden.includes("scatter") && visible.map((row) => <circle key={row.id} cx={left + row.gross / xMax * (right - left)} cy={bottom - row.bills / yMax * (bottom - top)} r="7" fill={COLORS[0]} className="report-dashboard-chart-target" tabIndex={0} role="button" aria-label={`${row.name}: ${labelOf("gross")} ${valueLabel(row.gross, "gross")}, ${labelOf("bills")} ${COUNT.format(row.bills)}`} onMouseEnter={() => setHover({ name: row.name, value: `${valueLabel(row.gross, "gross")} · ${COUNT.format(row.bills)} ครั้ง` })} onMouseLeave={() => setHover(null)} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row); }}></circle>)}
      <text x="450" y="325" textAnchor="middle">{labelOf("gross")} (บาท)</text><text x="20" y="150" transform="rotate(-90 20 150)" textAnchor="middle">{labelOf("bills")}</text>
    </svg></div></>;
  }

  if (kind === "stacked" && !cells) return <div className="report-dashboard-empty" role="status">กำลังโหลดข้อมูลยอดขายแยก Agent…</div>;
  const series = kind === "stacked" ? [...stackedAgents.map((agent, index) => ({ key: agent.id, label: agent.name, color: COLORS[index] ?? COLORS[5] })), { key: "other", label: "อื่น ๆ", color: COLORS[5] }] : kind === "combo" ? [{ key: "gross", label: `${labelOf("gross")} · บาท`, color: COLORS[0] }, { key: "bills", label: `${labelOf("bills")} · แกนขวา`, color: COLORS[1] }] : [{ key: metric, label: labelOf(metric), color: COLORS[0] }];
  const linePoints = visible.map((row, index) => `${x(index)},${y(row[metric])}`).join(" ");
  const cumulative = visible.reduce<number[]>((totals, row) => [...totals, (totals.at(-1) ?? 0) + row[metric]], []);
  const areaLow = min ?? Math.min(0, ...cumulative) * 1.08;
  const areaHigh = max ?? Math.max(...cumulative, 1) * 1.08;
  const areaSpan = Math.max(areaHigh - areaLow, 1);
  const areaY = (value: number) => bottom - (value - areaLow) / areaSpan * (bottom - top);
  const billHigh = Math.max(...visible.map((row) => row.bills), 1) * 1.08;
  return <>{legend(series)}{hover && <div className="report-dashboard-hover" role="tooltip"><b>{hover.name}</b><span>{hover.value}</span></div>}<div className="report-dashboard-chart-scroll"><svg className="report-dashboard-svg" viewBox={`0 0 ${width} 330`} role="img" aria-label={kind === "stacked" ? "กราฟแท่งซ้อนยอดขายแยก Agent" : kind === "combo" ? `กราฟผสม${labelOf("gross")}และ${labelOf("bills")}` : `กราฟ${kind === "bar" ? "แท่ง" : kind === "area" ? "พื้นที่สะสม" : "เส้น"}${labelOf(metric)}`}>
    <defs><clipPath id="report-dashboard-plot"><rect x={left} y={top} width={right - left} height={bottom - top} /></clipPath></defs>
    {[0, 1, 2, 3, 4].map((step) => { const position = top + step * (bottom - top) / 4; const axis = kind === "area" ? areaHigh - step / 4 * areaSpan : high - step / 4 * span; return <g key={step}>{showGrid && <line x1={left} x2={right} y1={position} y2={position} className="report-dashboard-gridline" />}<text x={left - 10} y={position + 4} textAnchor="end">{SHORT.format(axis)}</text>{kind === "combo" && <text x={right + 10} y={position + 4}>{SHORT.format(billHigh * (1 - step / 4))}</text>}</g>; })}
    {low < 0 && <line x1={left} x2={right} y1={zero} y2={zero} className="report-dashboard-zero" />}
    <g clipPath="url(#report-dashboard-plot)">
    {kind === "bar" && !hidden.includes(metric) && visible.map((row, index) => <rect key={row.id} x={x(index) - 17} y={Math.min(y(row[metric]), zero)} width="34" height={Math.max(2, Math.abs(zero - y(row[metric])))} rx="5" fill={row[metric] < 0 ? "#dc5c70" : COLORS[0]} className="report-dashboard-chart-target" role="button" tabIndex={0} aria-label={`${row.name}: ${valueLabel(row[metric], metric)}`} onMouseEnter={() => setHover({ name: row.name, value: valueLabel(row[metric], metric) })} onMouseLeave={() => setHover(null)} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row); }}></rect>)}
    {kind === "stacked" && visible.map((row, index) => { let total = 0; const rowCells = cells?.filter((cell) => cell.drawId === row.id) ?? []; return series.map((item) => { const value = item.key === "other" ? rowCells.filter((cell) => !stackedAgents.some((agent) => agent.id === cell.agentId)).reduce((sum, cell) => sum + cell.gross, 0) : rowCells.find((cell) => cell.agentId === item.key)?.gross ?? 0; if (hidden.includes(item.key) || !value) return null; const start = total; total += value; return <rect key={`${row.id}-${item.key}`} x={x(index) - 20} y={y(total)} width="40" height={Math.max(1, y(start) - y(total))} fill={item.color} className="report-dashboard-chart-target" role="button" tabIndex={0} aria-label={`${row.name} · ${item.label}: ${valueLabel(value, "gross")}`} onMouseEnter={() => setHover({ name: row.name, value: `${item.label}: ${valueLabel(value, "gross")}` })} onMouseLeave={() => setHover(null)} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row); }}></rect>; }); })}
    {kind === "area" && !hidden.includes(metric) && <><polygon points={`${x(0)},${areaY(0)} ${cumulative.map((value, index) => `${x(index)},${areaY(value)}`).join(" ")} ${x(visible.length - 1)},${areaY(0)}`} fill="rgba(22,119,255,.16)" /><polyline points={cumulative.map((value, index) => `${x(index)},${areaY(value)}`).join(" ")} fill="none" stroke={COLORS[0]} strokeWidth="3" />{areaLow < 0 && <line x1={left} x2={right} y1={areaY(0)} y2={areaY(0)} className="report-dashboard-zero" />}</>}
    {kind === "line" && !hidden.includes(metric) && <polyline points={linePoints} fill="none" stroke={COLORS[0]} strokeWidth="3" strokeLinejoin="round" />}
    {kind === "combo" && <>{!hidden.includes("gross") && visible.map((row, index) => <rect key={row.id} x={x(index) - 19} y={y(row.gross)} width="38" height={Math.max(1, bottom - y(row.gross))} rx="4" fill={COLORS[0]} opacity=".75"></rect>)}{!hidden.includes("bills") && <polyline points={visible.map((row, index) => `${x(index)},${bottom - row.bills / billHigh * (bottom - top)}`).join(" ")} fill="none" stroke={COLORS[1]} strokeWidth="3" />}</>}
    {(kind === "line" || kind === "area" || kind === "combo") && visible.map((row, index) => <circle key={row.id} cx={x(index)} cy={kind === "area" ? areaY(cumulative[index]!) : kind === "combo" ? bottom - row.bills / billHigh * (bottom - top) : y(row[metric])} r="6" fill={kind === "combo" ? COLORS[1] : COLORS[0]} stroke="#fff" strokeWidth="2" className="report-dashboard-chart-target" role="button" tabIndex={0} aria-label={`${row.name}: ${kind === "combo" ? `${valueLabel(row.gross, "gross")}, ${COUNT.format(row.bills)} บิล` : valueLabel(kind === "area" ? cumulative[index]! : row[metric], metric)}`} onMouseEnter={() => setHover({ name: row.name, value: kind === "combo" ? `${valueLabel(row.gross, "gross")} · ${COUNT.format(row.bills)} บิล` : valueLabel(kind === "area" ? cumulative[index]! : row[metric], metric) })} onMouseLeave={() => setHover(null)} onClick={() => onSelect(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(row); }}></circle>)}
    </g>
    {visible.map((row, index) => (index % Math.max(1, Math.ceil(visible.length / 6)) === 0 || index === visible.length - 1) && <text key={row.id} x={x(index)} y="302" textAnchor="middle">{xLabel(row)}</text>)}
    <text x="450" y="325" textAnchor="middle">{resolvedDimensionLabel}</text>
  </svg></div><p className="report-dashboard-scale">{kind === "area" ? `${labelOf(metric)}สะสม · ${isMoney(metric) ? "บาท" : "จำนวน"}` : kind === "combo" ? `แกนซ้าย: ${labelOf("gross")} (บาท) · แกนขวา: ${labelOf("bills")}` : kind === "stacked" ? "ยอดขายตาม Agent · บาท" : `${labelOf(metric)} · ${isMoney(metric) ? "บาท" : "จำนวน"}`}</p></>;
}

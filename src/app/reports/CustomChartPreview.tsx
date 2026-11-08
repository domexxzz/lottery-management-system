"use client";

import { useMemo, useState } from "react";
import {
  CHART_COLORS,
  FIELD_META,
  isNumeric,
  isTemporal,
  type Calculation,
  type ChartMatrixCell,
  type CustomChartSettings,
  type DataField,
  type TimeGrouping,
} from "./CustomChartTypes";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NUMBER = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });
const THAI_DATE = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "2-digit" });
const THAI_DATE_TIME = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const THAI_MONTH = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", month: "short", year: "numeric" });
const THAI_TIME = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, string> = { OPEN: "เปิดรับ", LOCKED: "ล็อกแล้ว", CLOSED: "ปิดบัญชี", ACTIVE: "ใช้งาน", INACTIVE: "ปิดใช้งาน", SUSPENDED: "ระงับ" };

type Category = { key: string; label: string; sort: number };
type ChartRow = Category & { value: number; secondary: number; count: number };
type Hover = { title: string; lines: string[] } | null;

function autoGrouping(cells: ChartMatrixCell[]): TimeGrouping {
  const times = cells.map((cell) => Date.parse(cell.cutoffAt)).filter(Number.isFinite);
  if (times.length < 2) return "day";
  const days = (Math.max(...times) - Math.min(...times)) / 86_400_000;
  if (days <= 2) return "hour";
  if (days <= 45) return "day";
  if (days <= 180) return "week";
  if (days <= 1_100) return "month";
  return "year";
}

function weekStart(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, date!));
  const offset = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - offset);
  return value.toISOString().slice(0, 10);
}

function temporalCategory(cell: ChartMatrixCell, field: DataField, grouping: TimeGrouping, cells: ChartMatrixCell[]): Category {
  const actual = grouping === "auto" ? autoGrouping(cells) : grouping;
  const time = Date.parse(cell.cutoffAt);
  const day = cell.cutoffDate;
  if (field === "cutoffTime" || actual === "hour") {
    const hourKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).format(new Date(time));
    return { key: field === "cutoffTime" ? THAI_TIME.format(new Date(time)) : hourKey, label: field === "cutoffTime" ? THAI_TIME.format(new Date(time)) : `${THAI_DATE.format(new Date(time))} ${THAI_TIME.format(new Date(time))}`, sort: time };
  }
  if (actual === "week") {
    const start = weekStart(day);
    const sort = Date.parse(`${start}T00:00:00+07:00`);
    return { key: start, label: `สัปดาห์ ${THAI_DATE.format(new Date(sort))}`, sort };
  }
  if (actual === "month") {
    const key = day.slice(0, 7);
    const sort = Date.parse(`${key}-01T00:00:00+07:00`);
    return { key, label: THAI_MONTH.format(new Date(sort)), sort };
  }
  if (actual === "year") {
    const key = day.slice(0, 4);
    return { key, label: `${Number(key) + 543}`, sort: Date.parse(`${key}-01-01T00:00:00+07:00`) };
  }
  return { key: day, label: THAI_DATE.format(new Date(time)), sort: time };
}

function categoryFor(cell: ChartMatrixCell, field: DataField, grouping: TimeGrouping, cells: ChartMatrixCell[]): Category {
  if (isTemporal(field)) return temporalCategory(cell, field, grouping, cells);
  if (field === "agent") return { key: cell.agentId, label: `${cell.agentCode} · ${cell.agentName}`, sort: 0 };
  if (field === "draw") return { key: cell.drawId, label: cell.drawName, sort: Date.parse(cell.cutoffAt) };
  if (field === "drawStatus") return { key: cell.drawStatus ?? "UNKNOWN", label: STATUS[cell.drawStatus ?? ""] ?? cell.drawStatus ?? "ไม่ระบุ", sort: 0 };
  if (field === "agentStatus") return { key: cell.agentStatus ?? "UNKNOWN", label: STATUS[cell.agentStatus ?? ""] ?? cell.agentStatus ?? "ไม่ระบุ", sort: 0 };
  const value = numericValue(cell, field);
  return { key: String(value), label: NUMBER.format(value), sort: value };
}

function numericValue(cell: ChartMatrixCell, field: DataField) {
  if (isTemporal(field)) return Date.parse(cell.cutoffAt);
  if (isNumeric(field)) return cell[field as keyof ChartMatrixCell] as number;
  return 0;
}

function aggregate(values: number[], calculation: Calculation) {
  if (!values.length) return 0;
  if (calculation === "count") return values.length;
  if (calculation === "average") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (calculation === "max") return Math.max(...values);
  if (calculation === "min") return Math.min(...values);
  if (calculation === "raw") return values[0]!;
  return values.reduce((sum, value) => sum + value, 0);
}

function applyFilters(cells: ChartMatrixCell[], settings: CustomChartSettings) {
  const { drawIds, agentIds, from, to } = settings.filters;
  return cells.filter((cell) => (!drawIds.length || drawIds.includes(cell.drawId)) && (!agentIds.length || agentIds.includes(cell.agentId)) && (!from || cell.cutoffDate >= from) && (!to || cell.cutoffDate <= to));
}

function formatChartValue(value: number, field: DataField, compact = false) {
  if (isTemporal(field)) return THAI_DATE_TIME.format(new Date(value));
  const formatted = compact ? COMPACT.format(value) : FIELD_META[field].money ? MONEY.format(value) : NUMBER.format(value);
  return `${formatted}${FIELD_META[field].money ? " บาท" : ""}`;
}

function makeScale(values: number[], start: number, end: number, includeZero: boolean, custom?: { min: number; max: number }) {
  const rawLow = custom ? custom.min : Math.min(includeZero ? 0 : Infinity, ...values);
  const rawHigh = custom ? custom.max : Math.max(includeZero ? 0 : -Infinity, ...values);
  const low = Number.isFinite(rawLow) ? rawLow : 0;
  const high = Number.isFinite(rawHigh) && rawHigh !== low ? rawHigh : low + 1;
  const absolute = values.map(Math.abs).filter((value) => value > 0).sort((a, b) => a - b);
  const median = absolute[Math.floor(absolute.length / 2)] ?? 1;
  const compressed = !custom && absolute.length > 20 && (absolute.at(-1) ?? 1) / Math.max(median, 1) > 30;
  const transform = (value: number) => compressed ? Math.sign(value) * Math.log1p(Math.abs(value) / Math.max(median, 1)) : value;
  const inverse = (value: number) => compressed ? Math.sign(value) * Math.expm1(Math.abs(value)) * Math.max(median, 1) : value;
  const transformedLow = transform(low), transformedHigh = transform(high);
  const map = (value: number) => start + (transform(value) - transformedLow) / Math.max(transformedHigh - transformedLow, 1e-9) * (end - start);
  const ticks = [0, 1, 2, 3, 4].map((step) => inverse(transformedLow + step / 4 * (transformedHigh - transformedLow)));
  return { map, ticks, compressed, low, high };
}

function arcPath(start: number, end: number, inner: number) {
  const angle = (portion: number) => portion * Math.PI * 2 - Math.PI / 2;
  const point = (portion: number, radius: number) => [170 + Math.cos(angle(portion)) * radius, 170 + Math.sin(angle(portion)) * radius];
  const outerA = point(start, 122), outerB = point(end, 122), innerA = point(start, inner), innerB = point(end, inner);
  const large = end - start > .5 ? 1 : 0;
  return inner ? `M ${outerA} A 122 122 0 ${large} 1 ${outerB} L ${innerB} A ${inner} ${inner} 0 ${large} 0 ${innerA} Z` : `M 170 170 L ${outerA} A 122 122 0 ${large} 1 ${outerB} Z`;
}

export function CustomChartPreview({ cells, settings }: { cells: ChartMatrixCell[]; settings: CustomChartSettings }) {
  const [hover, setHover] = useState<Hover>(null);
  const formatValue = (value: number, field: DataField, compact = false) => formatChartValue(value, field, compact && settings.filters.numberFormat === "compact");
  const filtered = useMemo(() => applyFilters(cells, settings), [cells, settings]);
  const rows = useMemo(() => {
    const groups = new Map<string, { category: Category; cells: ChartMatrixCell[] }>();
    for (const cell of filtered) {
      const category = categoryFor(cell, settings.x.field, settings.x.grouping, filtered);
      const current = groups.get(category.key) ?? { category, cells: [] };
      current.cells.push(cell);
      groups.set(category.key, current);
    }
    const result: ChartRow[] = [...groups.values()].map(({ category, cells: group }) => ({
      ...category,
      value: aggregate(group.map((cell) => numericValue(cell, settings.y.field)), settings.y.calculation),
      secondary: aggregate(group.map((cell) => cell.bills), "sum"),
      count: group.length,
    }));
    return result.sort((a, b) => settings.filters.sort === "value-desc" ? b.value - a.value : settings.filters.sort === "value-asc" ? a.value - b.value : settings.filters.sort === "time-desc" ? b.sort - a.sort : a.sort - b.sort);
  }, [filtered, settings]);

  const title = `${FIELD_META[settings.y.field].label}ตาม${FIELD_META[settings.x.field].label}`;
  const description = settings.kind === "scatter" ? `เปรียบเทียบ ${FIELD_META[settings.x.field].label} กับ ${FIELD_META[settings.y.field].label}` : `แสดง${FIELD_META[settings.y.field].label} แยกตาม${FIELD_META[settings.x.field].label}`;
  if (!filtered.length || !rows.length) return <section className="custom-preview-shell"><div className="custom-preview-empty"><span>⌁</span><strong>ไม่มีข้อมูลตามตัวกรองที่เลือก</strong><small>ลองล้างงวด, Agent หรือช่วงวันที่ใน Advanced Settings</small></div></section>;

  const tooltip = hover && <div className="custom-preview-tooltip" role="tooltip"><strong>{hover.title}</strong>{hover.lines.map((line) => <span key={line}>{line}</span>)}</div>;

  if (settings.kind === "pie" || settings.kind === "donut") {
    const ranked = [...rows].filter((row) => row.value > 0).sort((a, b) => b.value - a.value);
    const top = ranked.slice(0, 6);
    const other = ranked.slice(6).reduce((sum, row) => sum + row.value, 0);
    const segments = [...top, ...(other ? [{ key: "other", label: `อื่น ๆ (${ranked.length - 6} รายการ)`, sort: 0, value: other, secondary: 0, count: ranked.length - 6 }] : [])];
    const total = segments.reduce((sum, row) => sum + row.value, 0);
    let offset = 0;
    return <section className="custom-preview-shell"><header><div><span>LIVE PREVIEW</span><h3>{title}</h3><p>{description}</p></div><small>{filtered.length.toLocaleString("th-TH")} รายการข้อมูล</small></header>{tooltip}<div className="custom-preview-pie"><svg viewBox="0 0 340 340" role="img" aria-label={title}>{segments.map((row, index) => { const start = offset; offset += row.value / total; const percent = row.value / total * 100; return <path key={row.key} d={arcPath(start, offset, settings.kind === "donut" ? 72 : 0)} fill={CHART_COLORS[index % CHART_COLORS.length]} tabIndex={0} onMouseEnter={() => setHover({ title: row.label, lines: [formatValue(row.value, settings.y.field), `${percent.toFixed(1)}%`] })} onMouseLeave={() => setHover(null)} />; })}{settings.kind === "donut" && <><text x="170" y="164" textAnchor="middle" className="custom-preview-donut-total">{formatValue(total, settings.y.field, true)}</text><text x="170" y="187" textAnchor="middle">ยอดรวม</text></>}</svg><div className="custom-preview-legend">{segments.map((row, index) => <div key={row.key}><i style={{ background: CHART_COLORS[index % CHART_COLORS.length] }} /><span><b>{row.label}</b><small>{formatValue(row.value, settings.y.field)}</small></span><strong>{(row.value / total * 100).toFixed(1)}%</strong></div>)}</div></div></section>;
  }

  if (settings.kind === "horizontal-bar") {
    const visible = [...rows].sort((a, b) => b.value - a.value).slice(0, 12);
    const maximum = Math.max(...visible.map((row) => Math.abs(row.value)), 1);
    return <section className="custom-preview-shell"><header><div><span>LIVE PREVIEW</span><h3>{title}</h3><p>{description}</p></div><small>แสดง {visible.length} อันดับ</small></header>{tooltip}<div className="custom-preview-horizontal">{visible.map((row, index) => <button type="button" key={row.key} onMouseEnter={() => setHover({ title: row.label, lines: [formatValue(row.value, settings.y.field), `${row.count} คู่ งวด × Agent`] })} onMouseLeave={() => setHover(null)}><span>{index + 1}</span><b>{row.label}</b><i><u style={{ width: `${Math.max(2, Math.abs(row.value) / maximum * 100)}%`, background: settings.filters.color }} /></i><strong>{formatValue(row.value, settings.y.field, true)}</strong></button>)}</div></section>;
  }

  if (settings.kind === "scatter") {
    const raw = filtered.map((cell) => ({ cell, x: numericValue(cell, settings.x.field), y: numericValue(cell, settings.y.field) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).sort((a, b) => a.x - b.x);
    const sampleLimit = 160;
    const sampled = raw.length > sampleLimit ? Array.from({ length: sampleLimit }, (_, index) => raw[Math.min(raw.length - 1, Math.floor(index * raw.length / sampleLimit))]!) : raw;
    const xCustom = settings.x.range === "custom" && !isTemporal(settings.x.field) && Number(settings.x.min) < Number(settings.x.max) ? { min: Number(settings.x.min), max: Number(settings.x.max) } : undefined;
    const yCustom = settings.y.range === "custom" && !isTemporal(settings.y.field) && Number(settings.y.min) < Number(settings.y.max) ? { min: Number(settings.y.min), max: Number(settings.y.max) } : undefined;
    const xScale = makeScale(raw.map((point) => point.x), 88, 846, !isTemporal(settings.x.field), xCustom);
    const yScale = makeScale(raw.map((point) => point.y), 306, 34, !isTemporal(settings.y.field), yCustom);
    return <section className="custom-preview-shell"><header><div><span>LIVE PREVIEW</span><h3>{title}</h3><p>{description}</p></div><small>{raw.length.toLocaleString("th-TH")} จุดข้อมูล</small></header>{(raw.length > sampleLimit || xScale.compressed || yScale.compressed) && <div className="custom-preview-notice">{raw.length > sampleLimit ? `แสดงตัวอย่าง ${sampleLimit} จาก ${raw.length.toLocaleString("th-TH")} จุด โดยค่าสรุปยังคำนวณจากทั้งหมด` : ""}{(xScale.compressed || yScale.compressed) ? `${raw.length > sampleLimit ? " · " : ""}ระบบบีบอัดสเกลอัตโนมัติเพื่อให้เห็นค่าที่กระจุกตัว โดยไม่ตัดข้อมูลผิดปกติออก` : ""}</div>}{tooltip}<div className="custom-preview-chart-scroll"><svg className="custom-preview-svg" viewBox="0 0 940 380" role="img" aria-label={title}>{[0, 1, 2, 3, 4].map((step) => <g key={step}>{settings.filters.showGrid && <><line x1="88" x2="846" y1={34 + step * 68} y2={34 + step * 68} className="custom-preview-gridline" /><line x1={88 + step * 189.5} x2={88 + step * 189.5} y1="34" y2="306" className="custom-preview-gridline" /></>}<text x="78" y={39 + step * 68} textAnchor="end">{formatValue(yScale.ticks[4 - step]!, settings.y.field, true)}</text><text x={88 + step * 189.5} y="331" textAnchor="middle">{formatValue(xScale.ticks[step]!, settings.x.field, true)}</text></g>)}{sampled.map((point, index) => <circle key={`${point.cell.drawId}-${point.cell.agentId}-${index}`} cx={xScale.map(point.x)} cy={yScale.map(point.y)} r="5" fill={settings.filters.color} opacity={sampled.length > 80 ? .55 : .82} stroke="#fff" strokeWidth="1.5" tabIndex={0} onMouseEnter={() => setHover({ title: `${point.cell.drawName} · ${point.cell.agentCode}`, lines: [`${FIELD_META[settings.x.field].shortLabel}: ${formatValue(point.x, settings.x.field)}`, `${FIELD_META[settings.y.field].shortLabel}: ${formatValue(point.y, settings.y.field)}`] })} onMouseLeave={() => setHover(null)} />)}<text x="467" y="371" textAnchor="middle" className="custom-preview-axis-title">{FIELD_META[settings.x.field].label}</text><text x="18" y="170" transform="rotate(-90 18 170)" textAnchor="middle" className="custom-preview-axis-title">{FIELD_META[settings.y.field].label}</text></svg></div></section>;
  }

  const visible = rows.slice(0, 24);
  const stacked = settings.kind === "stacked";
  const topAgents = stacked ? [...new Map(filtered.map((cell) => [cell.agentId, { id: cell.agentId, label: cell.agentCode }])).values()].map((agent) => ({ ...agent, total: filtered.filter((cell) => cell.agentId === agent.id).reduce((sum, cell) => sum + numericValue(cell, settings.y.field), 0) })).sort((a, b) => b.total - a.total).slice(0, 5) : [];
  const stackedRows = stacked ? visible.map((row) => ({ row, values: topAgents.map((agent) => filtered.filter((cell) => categoryFor(cell, settings.x.field, settings.x.grouping, filtered).key === row.key && cell.agentId === agent.id).reduce((sum, cell) => sum + numericValue(cell, settings.y.field), 0)) })) : [];
  const values = stacked ? stackedRows.map((item) => item.values.reduce((sum, value) => sum + value, 0)) : visible.map((row) => row.value);
  const yCustom = settings.y.range === "custom" && Number(settings.y.min) < Number(settings.y.max) ? { min: Number(settings.y.min), max: Number(settings.y.max) } : undefined;
  const yScale = makeScale(values, 304, 32, true, yCustom);
  const plotWidth = 760;
  const stepWidth = plotWidth / Math.max(visible.length, 1);
  const x = (index: number) => 90 + stepWidth * (index + .5);
  const linePath = visible.map((row, index) => `${index ? "L" : "M"}${x(index)} ${yScale.map(row.value)}`).join(" ");
  return <section className="custom-preview-shell"><header><div><span>LIVE PREVIEW</span><h3>{title}</h3><p>{description}</p></div><small>{visible.length} กลุ่มข้อมูล</small></header>{yScale.compressed && <div className="custom-preview-notice">ระบบบีบอัดสเกลอัตโนมัติเพื่อให้เห็นแนวโน้ม โดยไม่ตัดค่าผิดปกติออก</div>}{tooltip}{settings.filters.showLegend && <div className="custom-preview-series-legend">{stacked ? topAgents.map((agent, index) => <span key={agent.id}><i style={{ background: CHART_COLORS[index] }} />{agent.label}</span>) : <span><i style={{ background: settings.filters.color }} />{FIELD_META[settings.y.field].label}</span>}{settings.kind === "combo" && <span><i style={{ background: CHART_COLORS[1] }} />จำนวนบิล</span>}</div>}<div className="custom-preview-chart-scroll"><svg className="custom-preview-svg" viewBox="0 0 940 380" role="img" aria-label={title}>{[0, 1, 2, 3, 4].map((gridStep) => <g key={gridStep}>{settings.filters.showGrid && <line x1="90" x2="850" y1={32 + gridStep * 68} y2={32 + gridStep * 68} className="custom-preview-gridline" />}<text x="80" y={37 + gridStep * 68} textAnchor="end">{formatValue(yScale.ticks[4 - gridStep]!, settings.y.field, true)}</text></g>)}{settings.kind === "area" && <path d={`${linePath} L ${x(visible.length - 1)} 304 L ${x(0)} 304 Z`} fill={settings.filters.color} opacity=".16" />}{(settings.kind === "line" || settings.kind === "area") && <path d={linePath} fill="none" stroke={settings.filters.color} strokeWidth="3" strokeLinejoin="round" />}{settings.kind === "bar" && visible.map((row, index) => <rect key={row.key} x={x(index) - Math.min(24, stepWidth * .32)} y={Math.min(yScale.map(row.value), yScale.map(0))} width={Math.min(48, stepWidth * .64)} height={Math.max(2, Math.abs(yScale.map(row.value) - yScale.map(0)))} rx="5" fill={row.value < 0 ? "#df5b70" : settings.filters.color} onMouseEnter={() => setHover({ title: row.label, lines: [formatValue(row.value, settings.y.field)] })} onMouseLeave={() => setHover(null)} />)}{stackedRows.map((item, index) => { let total = 0; return item.values.map((value, seriesIndex) => { const start = total; total += value; return <rect key={`${item.row.key}-${seriesIndex}`} x={x(index) - Math.min(25, stepWidth * .34)} y={yScale.map(total)} width={Math.min(50, stepWidth * .68)} height={Math.max(1, yScale.map(start) - yScale.map(total))} fill={CHART_COLORS[seriesIndex]} onMouseEnter={() => setHover({ title: item.row.label, lines: [`${topAgents[seriesIndex]?.label}: ${formatValue(value, settings.y.field)}`] })} onMouseLeave={() => setHover(null)} />; }); })}{settings.kind === "combo" && <>{visible.map((row, index) => <rect key={row.key} x={x(index) - Math.min(23, stepWidth * .3)} y={yScale.map(row.value)} width={Math.min(46, stepWidth * .6)} height={Math.max(2, 304 - yScale.map(row.value))} rx="4" fill={settings.filters.color} opacity=".72" />)}<polyline points={visible.map((row, index) => `${x(index)},${304 - row.secondary / Math.max(...visible.map((item) => item.secondary), 1) * 272}`).join(" ")} fill="none" stroke={CHART_COLORS[1]} strokeWidth="3" /></>}{(settings.kind === "line" || settings.kind === "area" || settings.kind === "combo") && visible.map((row, index) => <circle key={row.key} cx={x(index)} cy={settings.kind === "combo" ? 304 - row.secondary / Math.max(...visible.map((item) => item.secondary), 1) * 272 : yScale.map(row.value)} r="5" fill={settings.kind === "combo" ? CHART_COLORS[1] : settings.filters.color} stroke="#fff" strokeWidth="2" onMouseEnter={() => setHover({ title: row.label, lines: [formatValue(row.value, settings.y.field), ...(settings.kind === "combo" ? [`${NUMBER.format(row.secondary)} บิล`] : [])] })} onMouseLeave={() => setHover(null)} />)}{settings.filters.showLabels && visible.map((row, index) => <text key={`value-${row.key}`} x={x(index)} y={Math.max(20, yScale.map(row.value) - 9)} textAnchor="middle" className="custom-preview-data-label">{formatValue(row.value, settings.y.field, true)}</text>)}{visible.map((row, index) => (index % Math.max(1, Math.ceil(visible.length / 7)) === 0 || index === visible.length - 1) && <text key={`label-${row.key}`} x={x(index)} y="330" textAnchor="middle">{row.label.length > 13 ? `${row.label.slice(0, 12)}…` : row.label}</text>)}<text x="470" y="371" textAnchor="middle" className="custom-preview-axis-title">{FIELD_META[settings.x.field].label}</text><text x="18" y="170" transform="rotate(-90 18 170)" textAnchor="middle" className="custom-preview-axis-title">{FIELD_META[settings.y.field].label}</text></svg></div></section>;
}

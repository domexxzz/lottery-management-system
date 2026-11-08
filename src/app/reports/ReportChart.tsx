"use client";

import { useEffect, useMemo, useState } from "react";

export type ReportChartDatum = {
  id: string; code: string; name: string; href?: string;
  gross: number; payout: number; commission: number; net: number;
  bills: number; items: number; winners: number;
};
export type ReportChartDataset = { key: string; label: string; description: string; rows: ReportChartDatum[] };
type Metric = "gross" | "payout" | "commission" | "net" | "bills" | "items" | "winners";
type ChartType = "bar" | "line" | "donut" | "table";

const METRICS: Array<{ key: Metric; label: string; money: boolean; color: string }> = [
  { key: "gross", label: "ยอดขาย", money: true, color: "#1677ff" },
  { key: "payout", label: "จ่ายรางวัล", money: true, color: "#f0a31a" },
  { key: "commission", label: "คอมมิชชัน", money: true, color: "#7657d5" },
  { key: "net", label: "ยอดสุทธิ", money: true, color: "#16a477" },
  { key: "bills", label: "จำนวนบิล", money: false, color: "#168ca0" },
  { key: "items", label: "จำนวนรายการ", money: false, color: "#4184bc" },
  { key: "winners", label: "ถูกรางวัล", money: false, color: "#db5b65" },
];
const CHART_TYPES: Array<{ key: ChartType; label: string; icon: string }> = [
  { key: "bar", label: "แท่ง", icon: "▥" }, { key: "line", label: "เส้น", icon: "⌁" },
  { key: "donut", label: "โดนัท", icon: "◉" }, { key: "table", label: "ตาราง", icon: "▦" },
];
const COLORS = ["#1677ff", "#20a99a", "#7657d5", "#f0a31a", "#db5b65", "#3d91c8", "#8e69cf", "#6ebc4b", "#ea7b3d", "#4c6f9f"];
const NUMBER = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("th-TH", { notation: "compact", maximumFractionDigits: 1 });
function formatted(value: number, money: boolean) { return money ? `${MONEY.format(value)} บาท` : NUMBER.format(value); }

function BarChart({ rows, metric, select, selectedId }: { rows: ReportChartDatum[]; metric: Metric; select: (row: ReportChartDatum) => void; selectedId?: string }) {
  const ranked = [...rows].sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric])).slice(0, 10);
  const maximum = Math.max(...ranked.map((row) => Math.abs(row[metric])), 1);
  const config = METRICS.find((item) => item.key === metric)!;
  return <div className="report-viz-bars" role="list" aria-label={`กราฟแท่ง${config.label}`}>{ranked.map((row, index) => <button type="button" role="listitem" key={row.id} className={selectedId === row.id ? "selected" : undefined} onClick={() => select(row)}>
    <span className="report-viz-rank">{index + 1}</span><span className="report-viz-label"><b>{row.code}</b><small>{row.name}</small></span>
    <span className="report-viz-track"><i className={row[metric] < 0 ? "negative" : undefined} style={{ width: `${Math.max(Math.abs(row[metric]) / maximum * 100, 1.5)}%`, background: row[metric] < 0 ? undefined : config.color }}/></span>
    <strong className={row[metric] < 0 ? "negative" : undefined}>{formatted(row[metric], config.money)}</strong>
  </button>)}</div>;
}

function LineChart({ rows, metric, select, selectedId }: { rows: ReportChartDatum[]; metric: Metric; select: (row: ReportChartDatum) => void; selectedId?: string }) {
  const visible = rows.slice(-16), config = METRICS.find((item) => item.key === metric)!;
  const values = visible.map((row) => row[metric]), minimum = Math.min(0, ...values), maximum = Math.max(0, ...values, 1), range = Math.max(maximum - minimum, 1);
  const left = 48, right = 735, top = 22, bottom = 218;
  const points = visible.map((row, index) => ({ row, x: visible.length === 1 ? (left + right) / 2 : left + index / (visible.length - 1) * (right - left), y: top + (maximum - row[metric]) / range * (bottom - top) }));
  const zeroY = top + maximum / range * (bottom - top), path = points.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <div className="report-viz-line"><svg viewBox="0 0 780 265" role="img" aria-label={`กราฟเส้น${config.label}`}>
    {[0,1,2,3,4].map((step) => { const y = top + step / 4 * (bottom - top), value = maximum - step / 4 * range; return <g key={step}><line x1={left} x2={right} y1={y} y2={y}/><text x={left - 8} y={y + 4}>{COMPACT.format(value)}</text></g>; })}
    {minimum < 0 && <line className="zero-axis" x1={left} x2={right} y1={zeroY} y2={zeroY}/>}<path className="trend-area" d={`${path} L ${points.at(-1)?.x ?? right} ${zeroY} L ${points[0]?.x ?? left} ${zeroY} Z`} style={{ fill: `${config.color}18` }}/><path className="trend-line" d={path} style={{ stroke: config.color }}/>
    {points.map((point, index) => <g key={point.row.id} className={selectedId === point.row.id ? "selected" : undefined} role="button" tabIndex={0} onClick={() => select(point.row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(point.row); }}><circle cx={point.x} cy={point.y} r={selectedId === point.row.id ? 7 : 5} style={{ stroke: config.color }}/><title>{point.row.name}: {formatted(point.row[metric], config.money)}</title>{(visible.length <= 8 || index % 2 === 0 || index === visible.length - 1) && <text className="x-label" x={point.x} y="244">{point.row.code.slice(0, 12)}</text>}</g>)}
  </svg></div>;
}

function DonutChart({ rows, metric, select, selectedId }: { rows: ReportChartDatum[]; metric: Metric; select: (row: ReportChartDatum) => void; selectedId?: string }) {
  const config = METRICS.find((item) => item.key === metric)!;
  const visible = [...rows].sort((a, b) => Math.abs(b[metric]) - Math.abs(a[metric])).slice(0, 10), total = visible.reduce((sum, row) => sum + Math.abs(row[metric]), 0) || 1;
  let offset = 0;
  return <div className="report-viz-donut-layout"><div className="report-viz-donut"><svg viewBox="0 0 180 180" role="img" aria-label={`กราฟโดนัท${config.label}`}><circle className="donut-base" cx="90" cy="90" r="62" pathLength="100"/>{visible.map((row, index) => { const percent = Math.abs(row[metric]) / total * 100, currentOffset = offset; offset += percent; return <circle key={row.id} className={selectedId === row.id ? "selected" : undefined} cx="90" cy="90" r="62" pathLength="100" stroke={COLORS[index % COLORS.length]} strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-currentOffset} onClick={() => select(row)}><title>{row.name}: {percent.toFixed(1)}%</title></circle>; })}</svg><div><strong>{COMPACT.format(visible.reduce((sum, row) => sum + row[metric], 0))}</strong><span>{config.label}</span></div></div>
    <div className="report-viz-legend">{visible.map((row, index) => <button type="button" key={row.id} className={selectedId === row.id ? "selected" : undefined} onClick={() => select(row)}><i style={{ background: COLORS[index % COLORS.length] }}/><span><b>{row.code}</b><small>{row.name}</small></span><strong>{(Math.abs(row[metric]) / total * 100).toFixed(1)}%</strong></button>)}</div></div>;
}

function DataTable({ rows, metric, select, selectedId }: { rows: ReportChartDatum[]; metric: Metric; select: (row: ReportChartDatum) => void; selectedId?: string }) {
  const config = METRICS.find((item) => item.key === metric)!;
  return <div className="report-viz-table"><table><thead><tr><th>ข้อมูล</th><th className="num">{config.label}</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th className="num">สุทธิ</th><th className="num">บิล</th></tr></thead><tbody>{[...rows].sort((a,b) => Math.abs(b[metric]) - Math.abs(a[metric])).map((row) => <tr key={row.id} className={selectedId === row.id ? "selected" : undefined} tabIndex={0} onClick={() => select(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") select(row); }}><td><b>{row.code}</b><small>{row.name}</small></td><td className="num"><strong>{formatted(row[metric], config.money)}</strong></td><td className="num">{MONEY.format(row.gross)}</td><td className="num">{MONEY.format(row.payout)}</td><td className={`num ${row.net < 0 ? "negative" : ""}`}>{MONEY.format(row.net)}</td><td className="num">{NUMBER.format(row.bills)}</td></tr>)}</tbody></table></div>;
}

export function ReportChart({ datasets, initialDimension }: { datasets: ReportChartDataset[]; initialDimension?: string }) {
  const available = datasets.filter((item) => item.rows.length), [dimension, setDimension] = useState(initialDimension ?? available[0]?.key ?? datasets[0]?.key ?? "");
  const [metric, setMetric] = useState<Metric>("gross"), [chartType, setChartType] = useState<ChartType>("bar");
  const dataset = datasets.find((item) => item.key === dimension) ?? available[0] ?? datasets[0];
  const [selectedId, setSelectedId] = useState<string | undefined>(dataset?.rows[0]?.id), selected = dataset?.rows.find((row) => row.id === selectedId) ?? dataset?.rows[0], config = METRICS.find((item) => item.key === metric)!;
  useEffect(() => setSelectedId(dataset?.rows[0]?.id), [dataset?.key]);
  const totals = useMemo(() => dataset?.rows.reduce((sum, row) => ({ gross: sum.gross + row.gross, payout: sum.payout + row.payout, commission: sum.commission + row.commission, net: sum.net + row.net, bills: sum.bills + row.bills, items: sum.items + row.items, winners: sum.winners + row.winners }), { gross: 0, payout: 0, commission: 0, net: 0, bills: 0, items: 0, winners: 0 }), [dataset]);
  const average = dataset?.rows.length ? (totals?.[metric] ?? 0) / dataset.rows.length : 0;
  const highest = dataset?.rows.reduce<ReportChartDatum | undefined>((top, row) => !top || Math.abs(row[metric]) > Math.abs(top[metric]) ? row : top, undefined);
  const select = (row: ReportChartDatum) => setSelectedId(row.id);

  return <section className="report-panel report-chart-panel report-visual-center" aria-labelledby="performance-chart-heading">
    <div className="report-viz-heading">
      <div className="report-viz-title"><span className="report-viz-title-icon" aria-hidden="true">↗</span><div><span className="report-kicker">INTERACTIVE ANALYTICS</span><h2 id="performance-chart-heading">ภาพรวมและแนวโน้ม</h2><p>เลือกมุมมองที่ต้องการ แล้วกดข้อมูลในกราฟเพื่อดูรายละเอียด</p></div></div>
      <div className="report-chart-types" role="group" aria-label="เลือกรูปแบบกราฟ">{CHART_TYPES.map((type) => <button type="button" key={type.key} className={chartType === type.key ? "active" : undefined} aria-pressed={chartType === type.key} onClick={() => setChartType(type.key)}><span>{type.icon}</span>{type.label}</button>)}</div>
    </div>

    <div className="report-viz-controls">
      {datasets.length > 1 && <div className="report-viz-control-group"><div className="report-viz-control-label"><span>1</span><div><b>เลือกมุมมองข้อมูล</b><small>ต้องการเปรียบเทียบอะไร</small></div></div><div className="report-dimension-tabs" role="tablist" aria-label="เลือกมิติข้อมูล">{datasets.map((item, index) => <button type="button" role="tab" key={item.key} aria-selected={item.key === dataset?.key} onClick={() => setDimension(item.key)}><span className="report-dimension-icon" aria-hidden="true">{index + 1}</span><span><strong>{item.label}</strong><small>{item.description}</small></span><em>{item.rows.length.toLocaleString("th-TH")}</em></button>)}</div></div>}
      <div className="report-viz-control-group"><div className="report-viz-control-label"><span>{datasets.length > 1 ? "2" : "1"}</span><div><b>เลือกตัวเลขที่ต้องการดู</b><small>กราฟจะปรับตามตัวชี้วัดทันที</small></div></div><div className="report-metric-tabs report-metric-tabs-expanded" role="group" aria-label="เลือกตัวเลขในกราฟ">{METRICS.map((item) => <button type="button" key={item.key} className={metric === item.key ? "active" : undefined} aria-pressed={metric === item.key} onClick={() => setMetric(item.key)}><i style={{ background: item.color }}/><span>{item.label}</span></button>)}</div></div>
    </div>

    {dataset && <div className="report-viz-summary"><span><small>มุมมองปัจจุบัน</small><strong>{dataset.label}</strong><em>{dataset.rows.length.toLocaleString("th-TH")} รายการ</em></span><span><small>{config.label}รวม</small><strong className={(totals?.[metric] ?? 0) < 0 ? "negative" : undefined}>{formatted(totals?.[metric] ?? 0, config.money)}</strong><em>รวมทุกข้อมูลในมุมมอง</em></span><span><small>ค่าเฉลี่ยต่อรายการ</small><strong className={average < 0 ? "negative" : undefined}>{formatted(average, config.money)}</strong><em>ใช้เปรียบเทียบผลงาน</em></span><span><small>ค่าสูงสุด</small><strong>{highest ? formatted(highest[metric], config.money) : "—"}</strong><em>{highest?.name ?? "ยังไม่มีข้อมูล"}</em></span></div>}
    {!dataset || !dataset.rows.length ? <div className="report-empty">ยังไม่มีข้อมูลสำหรับสร้างกราฟ</div> : <div className="report-viz-workspace"><div className="report-viz-canvas" data-chart={chartType}><div className="report-viz-canvas-heading"><div><span>{config.label}</span><strong>{dataset.label}</strong></div><small>แสดง {Math.min(dataset.rows.length, chartType === "line" ? 16 : chartType === "table" ? dataset.rows.length : 10).toLocaleString("th-TH")} จาก {dataset.rows.length.toLocaleString("th-TH")} รายการ · คลิกเพื่อเจาะรายละเอียด</small></div>{chartType === "bar" && <BarChart rows={dataset.rows} metric={metric} selectedId={selected?.id} select={select}/>} {chartType === "line" && <LineChart rows={dataset.rows} metric={metric} selectedId={selected?.id} select={select}/>} {chartType === "donut" && <DonutChart rows={dataset.rows} metric={metric} selectedId={selected?.id} select={select}/>} {chartType === "table" && <DataTable rows={dataset.rows} metric={metric} selectedId={selected?.id} select={select}/>}</div>
      {selected && <aside className="report-drilldown" aria-live="polite"><div className="report-drilldown-title"><span>เจาะรายละเอียด</span><b>{selected.code}</b><h3>{selected.name}</h3></div><div className="report-drilldown-focus"><small>{config.label}</small><strong className={selected[metric] < 0 ? "negative" : undefined}>{formatted(selected[metric], config.money)}</strong><span>{Math.abs(selected[metric]) && totals ? `${(Math.abs(selected[metric]) / Math.max(Math.abs(totals[metric]), 1) * 100).toFixed(1)}% ของทั้งหมด` : "ยังไม่มีสัดส่วน"}</span></div><dl><div><dt>ยอดขาย</dt><dd>{MONEY.format(selected.gross)}</dd></div><div><dt>จ่ายรางวัล</dt><dd>{MONEY.format(selected.payout)}</dd></div><div><dt>คอมมิชชัน</dt><dd>{MONEY.format(selected.commission)}</dd></div><div><dt>สุทธิ</dt><dd className={selected.net < 0 ? "negative" : ""}>{MONEY.format(selected.net)}</dd></div><div><dt>บิล</dt><dd>{NUMBER.format(selected.bills)}</dd></div><div><dt>รายการ / ถูก</dt><dd>{NUMBER.format(selected.items)} / {NUMBER.format(selected.winners)}</dd></div></dl><div className="report-drilldown-ratio"><span>อัตราจ่ายรางวัล</span><b>{selected.gross ? (selected.payout / selected.gross * 100).toFixed(1) : "0.0"}%</b><i><u style={{ width: `${Math.min(selected.gross ? selected.payout / selected.gross * 100 : 0, 100)}%` }}/></i></div>{selected.href && <a href={selected.href}>ดูข้อมูลเจาะลึก →</a>}</aside>}
    </div>}
  </section>;
}

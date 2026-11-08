"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DateRangePicker } from "@/components/calendar";
import { ReportsDashboardChart, type DashboardChartKind } from "../reports/ReportsDashboardChart";
import type { ReportChartDataset, ReportChartDatum, ReportMetric } from "../reports/ReportChart";
import { CustomerBehaviorChartBuilder } from "./CustomerBehaviorChartBuilder";

type BehaviorDimension = "customers" | "prizes" | "time" | "timeline";
type BehaviorMetric = Extract<ReportMetric, "gross" | "bills" | "items">;
type Preset = { id: string; title: string; description: string; dimension: BehaviorDimension; metric: BehaviorMetric; kind: DashboardChartKind };
type Settings = { kind: DashboardChartKind; dimension: BehaviorDimension; metric: BehaviorMetric; showGrid: boolean; showLegend: boolean; min: string; max: string };

const PRESETS: Preset[] = [
  { id: "trend", title: "แนวโน้มยอดซื้อ", description: "ดูยอดซื้อของลูกค้าเรียงตามวันออกรางวัล", dimension: "timeline", metric: "gross", kind: "line" },
  { id: "customer-value", title: "ลูกค้ามูลค่าสูง", description: "เปรียบเทียบว่าลูกค้าคนใดมียอดซื้อสูง", dimension: "customers", metric: "gross", kind: "bar" },
  { id: "repeat", title: "ความถี่การซื้อ", description: "ดูว่าลูกค้าคนใดกลับมาซื้อบ่อย", dimension: "customers", metric: "bills", kind: "bar" },
  { id: "customer-share", title: "สัดส่วนยอดซื้อลูกค้า", description: "ดูส่วนแบ่งยอดซื้อของลูกค้าแต่ละราย", dimension: "customers", metric: "gross", kind: "donut" },
  { id: "purchase-time", title: "ช่วงเวลาที่ซื้อ", description: "เปรียบเทียบความถี่การซื้อช่วงเช้า บ่าย และเย็น", dimension: "time", metric: "bills", kind: "bar" },
  { id: "prize-interest", title: "ความสนใจประเภทรางวัล", description: "ดูสัดส่วนจำนวนเลขที่เลือกในแต่ละประเภทรางวัล", dimension: "prizes", metric: "items", kind: "pie" },
  { id: "value-frequency", title: "ยอดซื้อเทียบความถี่", description: "หาความสัมพันธ์ระหว่างยอดซื้อกับความถี่ซื้อของลูกค้า", dimension: "customers", metric: "gross", kind: "scatter" },
  { id: "purchase-mix", title: "ยอดซื้อและความถี่ตามงวด", description: "เปรียบเทียบยอดซื้อกับความถี่โดยใช้แกนแยกกัน", dimension: "timeline", metric: "gross", kind: "combo" },
  { id: "cumulative", title: "ยอดซื้อสะสม", description: "ดูยอดซื้อสะสมตามลำดับงวด", dimension: "timeline", metric: "gross", kind: "area" },
];

const KINDS: Array<{ value: DashboardChartKind; label: string }> = [
  { value: "line", label: "กราฟเส้น" },
  { value: "bar", label: "กราฟแท่ง" },
  { value: "area", label: "กราฟพื้นที่สะสม" },
  { value: "donut", label: "กราฟโดนัท" },
  { value: "pie", label: "กราฟวงกลม" },
  { value: "scatter", label: "กราฟกระจาย" },
  { value: "combo", label: "กราฟผสม" },
];

const METRICS: Array<{ value: BehaviorMetric; label: string }> = [
  { value: "gross", label: "ยอดซื้อ" },
  { value: "bills", label: "ความถี่ซื้อ" },
  { value: "items", label: "จำนวนเลขที่เลือก" },
];

const DIMENSION_LABELS: Record<BehaviorDimension, string> = {
  customers: "ลูกค้า",
  prizes: "ประเภทรางวัล",
  time: "ช่วงเวลาที่ซื้อ",
  timeline: "วันออกรางวัล",
};

const METRIC_LABELS: Partial<Record<ReportMetric, string>> = {
  gross: "ยอดซื้อ",
  bills: "ความถี่ซื้อ",
  items: "จำนวนเลขที่เลือก",
};

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("th-TH");
const baseSettings = (preset: Preset): Settings => ({ kind: preset.kind, dimension: preset.dimension, metric: preset.metric, showGrid: true, showLegend: true, min: "", max: "" });
const metricLabel = (metric: BehaviorMetric) => METRICS.find((item) => item.value === metric)?.label ?? metric;

export function CustomerBehaviorExplorer({ datasets, summary, selectedDrawId }: {
  datasets: ReportChartDataset[];
  summary: { customerCount: number; repeatCustomers: number; billCount: number; totalSales: number };
  selectedDrawId?: string;
}) {
  const router = useRouter();
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [settings, setSettings] = useState<Settings>(() => baseSettings(PRESETS[0]!));
  const [draft, setDraft] = useState<Settings>(settings);
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [period, setPeriod] = useState<6 | 12 | 24 | "custom">(12);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<ReportChartDatum | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const data = useMemo(() => new Map(datasets.map((dataset) => [dataset.key as BehaviorDimension, dataset])), [datasets]);
  const timelineRows = data.get("timeline")?.rows ?? [];
  const periodRows = useMemo(() => selectedDrawId
    ? timelineRows.filter((row) => row.id === selectedDrawId)
    : period === "custom"
      ? timelineRows.filter((row) => { const date = row.date?.slice(0, 10) ?? ""; return (!from || date >= from) && (!to || date <= to); })
      : timelineRows.slice(-period), [from, period, selectedDrawId, timelineRows, to]);
  const dataset = data.get(settings.dimension);
  const rows = settings.dimension === "timeline" ? periodRows : dataset?.rows ?? [];
  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0]!;
  const availablePresets = PRESETS.filter((item) => (data.get(item.dimension)?.rows.length ?? 0) > 0);
  const draftDataset = data.get(draft.dimension);
  const draftAllowedMetrics = (draftDataset?.metrics ?? []).filter((metric): metric is BehaviorMetric => metric === "gross" || metric === "bills" || metric === "items");
  const rangeValid = (draft.min === "" || Number.isFinite(Number(draft.min))) && (draft.max === "" || Number.isFinite(Number(draft.max))) && (draft.min === "" || draft.max === "" || Number(draft.max) > Number(draft.min));
  const averageOrder = summary.billCount ? summary.totalSales / summary.billCount : 0;
  const repeatRate = summary.customerCount ? summary.repeatCustomers / summary.customerCount * 100 : 0;
  const customTitle = `${metricLabel(settings.metric)} · ${DIMENSION_LABELS[settings.dimension]}`;

  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); triggerRef.current?.focus(); };
  }, [open]);

  function choosePreset(next: Preset) {
    setPresetId(next.id);
    setSettings(baseSettings(next));
    setSelected(null);
  }

  function chooseKind(kind: DashboardChartKind) {
    setSettings((current) => {
      const dimension: BehaviorDimension = kind === "scatter" ? "customers" : kind === "combo" || kind === "area" || kind === "line" ? "timeline" : kind === "pie" || kind === "donut" ? (current.dimension === "prizes" ? "prizes" : "customers") : current.dimension;
      const nextDataset = data.get(dimension);
      const metrics = nextDataset?.metrics?.filter((metric): metric is BehaviorMetric => metric === "gross" || metric === "bills" || metric === "items") ?? [];
      const metric = metrics.includes(current.metric) ? current.metric : metrics[0] ?? "gross";
      return { ...current, kind, dimension, metric, min: "", max: "" };
    });
    setPresetId("custom");
    setSelected(null);
  }

  function reset() {
    choosePreset(PRESETS[0]!);
    setPeriod(12);
    setFrom("");
    setTo("");
    setDraft(baseSettings(PRESETS[0]!));
    setAdvanced(false);
  }

  function openDrawer() { setDraft(settings); setAdvanced(false); setOpen(true); }
  function refresh() { setRefreshing(true); router.refresh(); window.setTimeout(() => setRefreshing(false), 800); }
  function updateDraftDimension(dimension: BehaviorDimension) {
    const nextDataset = data.get(dimension);
    const metrics = nextDataset?.metrics?.filter((metric): metric is BehaviorMetric => metric === "gross" || metric === "bills" || metric === "items") ?? [];
    setDraft((current) => ({ ...current, dimension, metric: metrics.includes(current.metric) ? current.metric : metrics[0] ?? "gross" }));
  }

  const chartDimension = settings.dimension === "timeline" ? "draws" : settings.dimension === "customers" ? "agents" : "prizes";
  const rowSelection = settings.dimension === "timeline" ? "last" : "first";

  return <section className="report-dashboard behavior-explorer" aria-labelledby="behavior-explorer-heading">
    <header className="report-dashboard-heading"><div><span className="report-kicker">CUSTOMER BEHAVIOR EXPLORER</span><h2 id="behavior-explorer-heading">สำรวจข้อมูลจากกราฟ</h2><p>เลือกเรื่องที่อยากรู้ ระบบจัดกราฟจากข้อมูลพฤติกรรมลูกค้าให้ทันที</p></div><div className="report-dashboard-heading-actions"><span className="behavior-only-badge">ข้อมูลพฤติกรรมเท่านั้น</span><button type="button" onClick={refresh} disabled={refreshing}>{refreshing ? "กำลังรีเฟรช…" : "↻ รีเฟรช"}</button></div></header>
    <div className="report-dashboard-mini-kpis" aria-label="สรุปพฤติกรรมลูกค้า"><div><small>ลูกค้าทั้งหมด</small><strong>{COUNT.format(summary.customerCount)}</strong></div><div><small>อัตราซื้อซ้ำ</small><strong>{repeatRate.toFixed(1)}%</strong></div><div><small>ความถี่ซื้อทั้งหมด</small><strong>{COUNT.format(summary.billCount)} ครั้ง</strong></div><div><small>ยอดซื้อต่อครั้ง</small><strong>{MONEY.format(averageOrder)}&nbsp;บาท</strong></div></div>
    <div className="report-dashboard-presets" aria-label="กราฟพฤติกรรมสำเร็จรูป"><span>อยากดูเรื่องไหน</span><div>{availablePresets.slice(0, 4).map((item) => <button type="button" key={item.id} aria-pressed={presetId === item.id} onClick={() => choosePreset(item)}>{item.title}</button>)}{availablePresets.length > 4 && <select aria-label="เลือกกราฟพฤติกรรมเพิ่มเติม" value={availablePresets.slice(4).some((item) => item.id === presetId) ? presetId : ""} onChange={(event) => { const next = availablePresets.find((item) => item.id === event.target.value); if (next) choosePreset(next); }}><option value="">กราฟเพิ่มเติม…</option>{availablePresets.slice(4).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>}</div></div>
    <div className="report-dashboard-chart-panel"><div className="report-dashboard-chart-heading"><div><span className="report-kicker">{presetId === "custom" ? "CUSTOM VIEW" : "กราฟสำเร็จรูป"}</span><h3>{presetId === "custom" ? customTitle : preset.title}</h3><p>{presetId === "custom" ? "กำลังแสดงมุมมองพฤติกรรมที่ปรับแต่ง" : preset.description}{settings.dimension === "timeline" ? ` · ${selectedDrawId ? "งวดที่เลือก" : period === "custom" ? `${periodRows.length} งวดในช่วงวันที่` : `${periodRows.length} งวดล่าสุด`}` : ""}</p></div><div className="report-dashboard-chart-actions"><label>รูปแบบกราฟ<select aria-label="เปลี่ยนรูปแบบกราฟพฤติกรรม" value={settings.kind} onChange={(event) => chooseKind(event.target.value as DashboardChartKind)}>{KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button ref={triggerRef} type="button" onClick={openDrawer}>⚙ ปรับแต่งกราฟ</button><button type="button" onClick={reset}>คืนค่าเริ่มต้น</button></div></div>
      {settings.dimension === "timeline" && <div className="report-dashboard-period" role="group" aria-label="เลือกช่วงข้อมูลพฤติกรรม"><span>ช่วงข้อมูล</span>{([6, 12, 24] as const).map((count) => <button key={count} type="button" aria-pressed={period === count} disabled={Boolean(selectedDrawId)} onClick={() => setPeriod(count)}>{count} งวด</button>)}<button type="button" aria-pressed={period === "custom"} disabled={Boolean(selectedDrawId)} onClick={() => setPeriod("custom")}>กำหนดวันที่</button>{period === "custom" && !selectedDrawId && <div className="report-dashboard-dates"><DateRangePicker startLabel="ตั้งแต่" endLabel="ถึงวันที่" startPlaceholder="เลือกวันเริ่มต้น" endPlaceholder="เลือกวันสิ้นสุด" startDate={from} endDate={to} onChange={({ startDate, endDate }) => { setFrom(startDate); setTo(endDate); }} /></div>}{selectedDrawId && <small>กำลังดูงวดที่เลือกจากตัวกรองด้านบน</small>}</div>}
      <ReportsDashboardChart kind={settings.kind} rows={rows} metric={settings.metric} dimension={chartDimension} showGrid={settings.showGrid} showLegend={settings.showLegend} min={settings.min === "" ? undefined : Number(settings.min)} max={settings.max === "" ? undefined : Number(settings.max)} onSelect={setSelected} metricLabels={METRIC_LABELS} dimensionLabel={DIMENSION_LABELS[settings.dimension]} entityLabel="รายการ" rowSelection={rowSelection} />
      {selected && <div className="report-dashboard-selection" aria-live="polite"><b>{selected.name}</b><span>ยอดซื้อ {MONEY.format(selected.gross)} บาท</span>{selected.bills > 0 && <span>ความถี่ {COUNT.format(selected.bills)} ครั้ง</span>}{selected.items > 0 && <span>เลขที่เลือก {COUNT.format(selected.items)} รายการ</span>}{selected.href && <a href={selected.href}>ดูรายละเอียดลูกค้า →</a>}</div>}
    </div>
    {open && createPortal(<div className="report-dashboard-drawer-backdrop" onClick={() => setOpen(false)}><aside ref={drawerRef} className={`report-dashboard-drawer${advanced ? " report-dashboard-drawer--advanced" : ""}`} role="dialog" aria-modal="true" aria-labelledby="behavior-drawer-heading" onClick={(event) => event.stopPropagation()}><header><div><span className="report-kicker">CUSTOMER CHART SETTINGS</span><h2 id="behavior-drawer-heading">ปรับแต่งกราฟพฤติกรรม</h2><p>ทุกตัวเลือกใช้เฉพาะข้อมูลลูกค้าและการซื้อ</p></div><button type="button" aria-label="ปิดการตั้งค่ากราฟพฤติกรรม" onClick={() => setOpen(false)}>×</button></header><div className="report-dashboard-drawer-tabs"><button type="button" aria-pressed={!advanced} onClick={() => setAdvanced(false)}>ตั้งค่าทั่วไป</button><button type="button" aria-pressed={advanced} onClick={() => setAdvanced(true)}>กำหนดแกน X/Y</button></div>{advanced ? <div className="report-dashboard-drawer-body report-dashboard-drawer-body--advanced"><CustomerBehaviorChartBuilder datasets={datasets} initialDimension={settings.dimension} /></div> : <><div className="report-dashboard-drawer-body"><label>รูปแบบกราฟ<select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as DashboardChartKind }))}>{KINDS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label>กลุ่มข้อมูล<select value={draft.dimension} onChange={(event) => updateDraftDimension(event.target.value as BehaviorDimension)}>{datasets.filter((item) => item.rows.length).map((item) => <option value={item.key} key={item.key}>{item.label}</option>)}</select></label><label>ตัวชี้วัด<select value={draft.metric} onChange={(event) => setDraft({ ...draft, metric: event.target.value as BehaviorMetric })}>{draftAllowedMetrics.map((metric) => <option value={metric} key={metric}>{metricLabel(metric)}</option>)}</select></label>{!(["donut", "pie", "scatter"] as DashboardChartKind[]).includes(draft.kind) && <div className="report-dashboard-range"><span>ช่วงค่าแกน Y <small>เว้นว่างเพื่อให้ระบบคำนวณอัตโนมัติ</small></span><label>Min<input type="number" inputMode="decimal" value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} /></label><label>Max<input type="number" inputMode="decimal" value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} /></label></div>}{!rangeValid && <p role="alert" className="report-dashboard-validation">Max ต้องมากกว่า Min</p>}<label className="report-dashboard-toggle"><input type="checkbox" checked={draft.showLegend} onChange={(event) => setDraft({ ...draft, showLegend: event.target.checked })} />แสดงคำอธิบายสี</label><label className="report-dashboard-toggle"><input type="checkbox" checked={draft.showGrid} onChange={(event) => setDraft({ ...draft, showGrid: event.target.checked })} />แสดงเส้นตาราง</label><p className="report-dashboard-drawer-hint">ต้องการกำหนดแกนและรูปแบบละเอียด ให้เปิดแท็บ “กำหนดแกน X/Y”</p></div><footer><button type="button" onClick={() => setOpen(false)}>ยกเลิก</button><button type="button" onClick={() => setDraft(baseSettings(PRESETS[0]!))}>คืนค่าเริ่มต้น</button><button type="button" disabled={!rangeValid} onClick={() => { setSettings(draft); setPresetId("custom"); setSelected(null); setOpen(false); }}>ใช้การตั้งค่า</button></footer></>}</aside></div>, document.body)}
  </section>;
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { DateRangePicker } from "@/components/calendar";
import { LazyCustomChartBuilder } from "./LazyCustomChartBuilder";
import type { ChartMatrixCell } from "./CustomChartBuilder";
import type { ReportChartDatum, ReportMetric } from "./ReportChart";
import { ReportsDashboardChart, type DashboardChartKind } from "./ReportsDashboardChart";

type Dimension = "draws" | "agents" | "prizes";
type Preset = { id: string; title: string; description: string; dimension: Dimension; metric: ReportMetric; kind: DashboardChartKind };
type Settings = { kind: DashboardChartKind; dimension: Dimension; metric: ReportMetric; showGrid: boolean; showLegend: boolean; min: string; max: string };

const PRESETS: Preset[] = [
  { id: "overview", title: "ภาพรวมยอดขาย", description: "ยอดขายของแต่ละงวดตามลำดับเวลา", dimension: "draws", metric: "gross", kind: "line" },
  { id: "draws", title: "เปรียบเทียบรายงวด", description: "ดูว่างวดใดมียอดขายมากหรือน้อย", dimension: "draws", metric: "gross", kind: "bar" },
  { id: "agents", title: "ยอดขายตาม Agent", description: "เปรียบเทียบยอดขายของตัวแทน", dimension: "agents", metric: "gross", kind: "bar" },
  { id: "share", title: "สัดส่วนยอดขาย", description: "ดูสัดส่วนยอดขายของ Agent แต่ละราย", dimension: "agents", metric: "gross", kind: "donut" },
  { id: "bills", title: "ยอดขายกับจำนวนบิล", description: "เทียบยอดขายและจำนวนบิลโดยใช้แกนแยกกัน", dimension: "draws", metric: "gross", kind: "combo" },
  { id: "cumulative", title: "ยอดขายสะสม", description: "ดูยอดขายสะสมตามลำดับงวด", dimension: "draws", metric: "gross", kind: "area" },
  { id: "relationship", title: "ยอดขายเทียบจำนวนบิล", description: "ความสัมพันธ์ระหว่างยอดขายและจำนวนบิลของ Agent", dimension: "agents", metric: "gross", kind: "scatter" },
  { id: "agent-breakdown", title: "ยอดขายแยก Agent รายงวด", description: "แท่งซ้อนแสดงยอดขายตามตัวแทนในแต่ละงวด", dimension: "draws", metric: "gross", kind: "stacked" },
  { id: "prizes", title: "ยอดขายตามประเภทรางวัล", description: "เปรียบเทียบยอดขายของรางวัลแต่ละประเภท", dimension: "prizes", metric: "gross", kind: "pie" },
];
const KINDS: { value: DashboardChartKind; label: string }[] = [
  { value: "line", label: "กราฟเส้น" }, { value: "bar", label: "กราฟแท่ง" },
  { value: "stacked", label: "กราฟแท่งซ้อน" }, { value: "area", label: "กราฟพื้นที่สะสม" },
  { value: "donut", label: "กราฟโดนัท" }, { value: "pie", label: "กราฟวงกลม" },
  { value: "scatter", label: "กราฟกระจาย" }, { value: "combo", label: "กราฟผสม" },
];
const METRICS: { value: ReportMetric; label: string }[] = [
  { value: "gross", label: "ยอดขาย" }, { value: "payout", label: "จ่ายรางวัล" },
  { value: "commission", label: "คอมมิชชัน" }, { value: "net", label: "ยอดสุทธิ" },
  { value: "bills", label: "จำนวนบิล" }, { value: "items", label: "จำนวนรายการ" },
  { value: "winners", label: "รายการถูกรางวัล" },
];
const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("th-TH");
const baseSettings = (preset: Preset): Settings => ({ kind: preset.kind, dimension: preset.dimension, metric: preset.metric, showGrid: true, showLegend: true, min: "", max: "" });

export function ReportsAnalyticsDashboard({ draws, agents, prizes, selectedDrawId, summary, exportHref }: {
  draws: ReportChartDatum[];
  agents: ReportChartDatum[];
  prizes: ReportChartDatum[];
  selectedDrawId?: string;
  summary: { gross: number; billCount: number; itemCount: number };
  exportHref: string;
}) {
  const router = useRouter();
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [presetId, setPresetId] = useState("overview");
  const [settings, setSettings] = useState<Settings>(() => baseSettings(PRESETS[0]!));
  const [draft, setDraft] = useState<Settings>(settings);
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(true);
  const [period, setPeriod] = useState<6 | 12 | 24 | "custom">(12);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<ReportChartDatum | null>(null);
  const [matrix, setMatrix] = useState<ChartMatrixCell[] | null>(null);
  const [matrixError, setMatrixError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0]!;
  const customTitle = `${METRICS.find((item) => item.value === settings.metric)?.label ?? "ข้อมูล"} · ${settings.dimension === "draws" ? "รายงวด" : settings.dimension === "agents" ? "ราย Agent" : "ตามประเภทรางวัล"}`;
  const periodDraws = useMemo(() => selectedDrawId ? draws.filter((draw) => draw.id === selectedDrawId) : period === "custom" ? draws.filter((draw) => (!from || (draw.date ?? "") >= from) && (!to || (draw.date ?? "") <= to)) : draws.slice(-period), [draws, from, period, selectedDrawId, to]);
  const rows = settings.dimension === "draws" ? periodDraws : settings.dimension === "agents" ? agents : prizes;
  const rangeValid = (draft.min === "" || Number.isFinite(Number(draft.min))) && (draft.max === "" || Number.isFinite(Number(draft.max))) && (draft.min === "" || draft.max === "" || Number(draft.max) > Number(draft.min));
  const canShare = settings.dimension !== "draws" && rows.some((row) => row[settings.metric] > 0);
  const availablePresets = PRESETS.filter((item) => item.dimension === "draws" ? draws.length > 0 : item.dimension === "agents" ? agents.length > 0 : prizes.length > 0);
  const compatibleKinds = KINDS.filter((item) => {
    if (item.value === "scatter") return agents.some((agent) => agent.gross > 0 && agent.bills > 0);
    if (item.value === "stacked") return draws.length > 0;
    if (item.value === "combo" || item.value === "area") return draws.length > 0;
    if (item.value === "donut" || item.value === "pie") return canShare || agents.some((agent) => agent.gross > 0);
    return true;
  });

  useEffect(() => {
    if (settings.kind !== "stacked" || matrix || matrixError) return;
    const controller = new AbortController();
    fetch("/api/reports/chart-matrix", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(`โหลดข้อมูลกราฟแท่งซ้อนไม่สำเร็จ (${response.status})`); return response.json() as Promise<ChartMatrixCell[]>; })
      .then(setMatrix)
      .catch((error: unknown) => { if (!controller.signal.aborted) setMatrixError(error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ"); });
    return () => controller.abort();
  }, [settings.kind, matrix, matrixError]);

  useEffect(() => {
    if (!open) return;
    drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key !== "Tab" || !drawerRef.current) return;
      const focusable = [...drawerRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')];
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("keydown", close); triggerRef.current?.focus(); };
  }, [open]);

  function choosePreset(next: Preset) { setPresetId(next.id); setSettings(baseSettings(next)); setSelected(null); }
  function chooseKind(kind: DashboardChartKind) {
    setSettings((current) => ({ ...current, kind, dimension: kind === "scatter" ? "agents" : kind === "stacked" || kind === "combo" || kind === "area" ? "draws" : kind === "donut" || kind === "pie" ? current.dimension === "prizes" ? "prizes" : "agents" : current.dimension, metric: ["scatter", "combo", "stacked", "donut", "pie"].includes(kind) ? "gross" : current.metric, min: "", max: "" }));
    setPresetId("custom");
    setSelected(null);
  }
  function reset() { choosePreset(PRESETS[0]!); setPeriod(12); setFrom(""); setTo(""); setDraft(baseSettings(PRESETS[0]!)); setAdvanced(true); }
  function openDrawer() { setDraft(settings); setAdvanced(true); setOpen(true); }
  function refresh() { setRefreshing(true); router.refresh(); window.setTimeout(() => setRefreshing(false), 900); }

  return <section className="report-dashboard" aria-labelledby="report-dashboard-heading">
    <header className="report-dashboard-heading"><div><span className="report-kicker">ANALYTICS DASHBOARD</span><h2 id="report-dashboard-heading">สำรวจข้อมูลจากกราฟ</h2><p>เลือกหัวข้อที่สนใจ ระบบจัดกราฟและข้อมูลให้ทันที</p></div><div className="report-dashboard-heading-actions"><button type="button" onClick={refresh} disabled={refreshing}>{refreshing ? "กำลังรีเฟรช…" : "↻ รีเฟรช"}</button><a href={exportHref}>↓ ส่งออก Agent CSV</a></div></header>
    <div className="report-dashboard-mini-kpis" aria-label="สรุปข้อมูลการขาย"><div><small>จำนวนบิล</small><strong>{COUNT.format(summary.billCount)}</strong></div><div><small>เฉลี่ยต่อรายการ</small><strong>{summary.itemCount ? MONEY.format(summary.gross / summary.itemCount) : "0.00"}&nbsp;บาท</strong></div><div><small>ยอดขายสูงสุด · {draws.length} งวดล่าสุด</small><strong>{MONEY.format(Math.max(0, ...draws.map((draw) => draw.gross)))}&nbsp;บาท</strong></div><div><small>Agent ที่มีรายการขาย</small><strong>{COUNT.format(agents.filter((agent) => agent.bills > 0).length)}</strong></div></div>
    <div className="report-dashboard-presets" aria-label="กราฟสำเร็จรูป"><span>อยากดูเรื่องไหน</span><div>{availablePresets.slice(0, 4).map((item) => <button type="button" key={item.id} aria-pressed={presetId === item.id} onClick={() => choosePreset(item)}>{item.title}</button>)}{availablePresets.length > 4 && <select aria-label="เลือกกราฟเพิ่มเติม" value={availablePresets.slice(4).some((item) => item.id === presetId) ? presetId : ""} onChange={(event) => { const next = availablePresets.find((item) => item.id === event.target.value); if (next) choosePreset(next); }}><option value="">กราฟเพิ่มเติม…</option>{availablePresets.slice(4).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>}</div></div>
    <div className="report-dashboard-chart-panel"><div className="report-dashboard-chart-heading"><div><span className="report-kicker">{presetId === "custom" ? "CUSTOM VIEW" : "กราฟสำเร็จรูป"}</span><h3>{presetId === "custom" ? customTitle : preset.title}</h3><p>{presetId === "custom" ? "กำลังแสดงค่าที่ปรับแต่ง" : preset.description}{settings.dimension === "draws" ? ` · ${selectedDrawId ? "งวดที่เลือก" : period === "custom" ? `${periodDraws.length} งวดในช่วงวันที่` : `${periodDraws.length} งวดล่าสุด`}` : ""}</p></div><div className="report-dashboard-chart-actions"><label>รูปแบบกราฟ<select aria-label="เปลี่ยนรูปแบบกราฟ" value={settings.kind} onChange={(event) => chooseKind(event.target.value as DashboardChartKind)}>{compatibleKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button ref={triggerRef} type="button" onClick={openDrawer}>⚙ ปรับแต่งกราฟ</button><button type="button" onClick={reset}>คืนค่าเริ่มต้น</button></div></div>
      {settings.dimension === "draws" && <div className="report-dashboard-period" role="group" aria-label="เลือกช่วงเวลาที่แสดง"><span>ช่วงข้อมูล</span>{([6, 12, 24] as const).map((count) => <button key={count} type="button" aria-pressed={period === count} disabled={Boolean(selectedDrawId)} onClick={() => setPeriod(count)}>{count} งวด</button>)}<button type="button" aria-pressed={period === "custom"} disabled={Boolean(selectedDrawId)} onClick={() => setPeriod("custom")}>กำหนดวันที่</button>{period === "custom" && !selectedDrawId && <div className="report-dashboard-dates"><DateRangePicker startLabel="ตั้งแต่" endLabel="ถึงวันที่" startPlaceholder="เลือกวันเริ่มต้น" endPlaceholder="เลือกวันสิ้นสุด" startDate={from} endDate={to} onChange={({ startDate, endDate }) => { setFrom(startDate); setTo(endDate); }} /></div>}{selectedDrawId && <small>กำลังดูงวดที่เลือกด้านบน</small>}</div>}
      {matrixError && settings.kind === "stacked" ? <div className="report-dashboard-empty" role="alert">{matrixError} <button type="button" onClick={() => setMatrixError("")}>ลองอีกครั้ง</button></div> : <ReportsDashboardChart kind={settings.kind} rows={rows} metric={settings.metric} dimension={settings.dimension} cells={matrix ?? undefined} showGrid={settings.showGrid} showLegend={settings.showLegend} min={settings.min === "" ? undefined : Number(settings.min)} max={settings.max === "" ? undefined : Number(settings.max)} onSelect={setSelected} />}
      {selected && <div className="report-dashboard-selection" aria-live="polite"><b>{selected.name}</b><span>ยอดขาย {MONEY.format(selected.gross)} บาท</span><span>จำนวนบิล {COUNT.format(selected.bills)}</span>{selected.href && <a href={selected.href}>ดูรายละเอียด →</a>}</div>}
    </div>
    {open && createPortal(<div className="report-dashboard-drawer-backdrop" onClick={() => setOpen(false)}><aside ref={drawerRef} className={`report-dashboard-drawer${advanced ? " report-dashboard-drawer--advanced" : ""}`} role="dialog" aria-modal="true" aria-labelledby="report-dashboard-drawer-heading" onClick={(event) => event.stopPropagation()}><header><div><span className="report-kicker">CHART SETTINGS</span><h2 id="report-dashboard-drawer-heading">ปรับแต่งกราฟ</h2><p>เปลี่ยนเท่าที่ต้องการ แล้วกดใช้การตั้งค่า</p></div><button type="button" aria-label="ปิดการตั้งค่ากราฟ" onClick={() => setOpen(false)}>×</button></header><div className="report-dashboard-drawer-tabs"><button type="button" aria-pressed={!advanced} onClick={() => setAdvanced(false)}>ตั้งค่าทั่วไป</button><button type="button" aria-pressed={advanced} onClick={() => setAdvanced(true)}>กำหนดแกน X/Y</button></div>{advanced ? <div className="report-dashboard-drawer-body report-dashboard-drawer-body--advanced"><LazyCustomChartBuilder /></div> : <><div className="report-dashboard-drawer-body"><label>รูปแบบกราฟ<select value={draft.kind} onChange={(event) => { const kind = event.target.value as DashboardChartKind; setDraft((current) => ({ ...current, kind, dimension: kind === "scatter" ? "agents" : kind === "stacked" || kind === "combo" || kind === "area" ? "draws" : kind === "donut" || kind === "pie" ? current.dimension === "prizes" ? "prizes" : "agents" : current.dimension, metric: ["scatter", "combo", "stacked", "donut", "pie"].includes(kind) ? "gross" : current.metric })); }}>{compatibleKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{!["scatter", "stacked", "combo"].includes(draft.kind) && <label>กลุ่มข้อมูล<select value={draft.dimension} onChange={(event) => setDraft({ ...draft, dimension: event.target.value as Dimension, metric: event.target.value === "prizes" && !["gross", "payout", "items", "winners"].includes(draft.metric) ? "gross" : draft.metric })}><option value="draws">รายงวด</option><option value="agents">ราย Agent</option><option value="prizes">ตามประเภทรางวัล</option></select></label>}{!["scatter", "stacked", "combo"].includes(draft.kind) && <label>ตัวชี้วัด<select value={draft.metric} onChange={(event) => setDraft({ ...draft, metric: event.target.value as ReportMetric })}>{METRICS.filter((item) => draft.dimension !== "prizes" || ["gross", "payout", "items", "winners"].includes(item.value)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}{draft.kind !== "donut" && draft.kind !== "pie" && draft.kind !== "scatter" && <div className="report-dashboard-range"><span>ช่วงค่าแกน Y <small>เว้นว่างเพื่อใช้ค่าอัตโนมัติ</small></span><label>Min<input type="number" inputMode="decimal" value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} /></label><label>Max<input type="number" inputMode="decimal" value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} /></label></div>}{!rangeValid && <p role="alert" className="report-dashboard-validation">Max ต้องมากกว่า Min</p>}<label className="report-dashboard-toggle"><input type="checkbox" checked={draft.showLegend} onChange={(event) => setDraft({ ...draft, showLegend: event.target.checked })} />แสดงคำอธิบายสี</label><label className="report-dashboard-toggle"><input type="checkbox" checked={draft.showGrid} onChange={(event) => setDraft({ ...draft, showGrid: event.target.checked })} />แสดงเส้นตาราง</label><p className="report-dashboard-drawer-hint">หากต้องเลือกงวดหรือ Agent แยกกันในแต่ละแกน ใช้แท็บ “กำหนดแกน X/Y”</p></div><footer><button type="button" onClick={() => setOpen(false)}>ยกเลิก</button><button type="button" onClick={() => setDraft(baseSettings(PRESETS[0]!))}>คืนค่าเริ่มต้น</button><button type="button" disabled={!rangeValid} onClick={() => { setSettings(draft); setPresetId("custom"); setOpen(false); setSelected(null); }}>ใช้การตั้งค่า</button></footer></>}</aside></div>, document.body)}
  </section>;
}

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
type Period = "current" | "compare" | "month" | "custom";
type Preset = { id: string; title: string; description: string; dimension: Dimension; metric: ReportMetric; kind: DashboardChartKind };
type Settings = { kind: DashboardChartKind; dimension: Dimension; metric: ReportMetric; showGrid: boolean; showLegend: boolean; min: string; max: string };

const PRESETS: Preset[] = [
  { id: "overview", title: "ภาพรวมยอดขาย", description: "ยอดขายของแต่ละงวดตามลำดับเวลา", dimension: "draws", metric: "gross", kind: "bar" },
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
const MONTH_LABEL = new Intl.DateTimeFormat("th-TH", { month: "long", year: "numeric", timeZone: "Asia/Bangkok" });
const baseSettings = (preset: Preset): Settings => ({ kind: preset.kind, dimension: preset.dimension, metric: preset.metric, showGrid: true, showLegend: true, min: "", max: "" });

export function ReportsAnalyticsDashboard({ draws, agents, prizes, selectedDrawId, summary }: {
  draws: ReportChartDatum[];
  agents: ReportChartDatum[];
  prizes: ReportChartDatum[];
  selectedDrawId?: string;
  summary: { gross: number; billCount: number; itemCount: number };
}) {
  const router = useRouter();
  const drawerRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [presetId, setPresetId] = useState("overview");
  const [settings, setSettings] = useState<Settings>(() => baseSettings(PRESETS[0]!));
  const [draft, setDraft] = useState<Settings>(settings);
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(true);
  const [period, setPeriod] = useState<Period>("current");
  const [selectedMonth, setSelectedMonth] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<ReportChartDatum | null>(null);
  const [matrix, setMatrix] = useState<ChartMatrixCell[] | null>(null);
  const [matrixError, setMatrixError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");

  const preset = PRESETS.find((item) => item.id === presetId) ?? PRESETS[0]!;
  const customTitle = `${METRICS.find((item) => item.value === settings.metric)?.label ?? "ข้อมูล"} · ${settings.dimension === "draws" ? "รายงวด" : settings.dimension === "agents" ? "ราย Agent" : "ตามประเภทรางวัล"}`;
  const monthOptions = useMemo(() => [...new Set(draws.map((draw) => draw.date?.slice(0, 7)).filter((value): value is string => Boolean(value)))]
    .sort((left, right) => right.localeCompare(left))
    .map((value) => ({ value, label: MONTH_LABEL.format(new Date(`${value}-01T12:00:00+07:00`)) })), [draws]);
  const activeMonth = selectedMonth || monthOptions[0]?.value || "";
  const periodDraws = useMemo(() => {
    if (selectedDrawId) return draws.filter((draw) => draw.id === selectedDrawId);
    if (period === "current") return draws.slice(-1);
    if (period === "compare") return draws.slice(-2);
    if (period === "month") return draws.filter((draw) => draw.date?.startsWith(activeMonth));
    return draws.filter((draw) => (!from || (draw.date ?? "") >= from) && (!to || (draw.date ?? "") <= to));
  }, [activeMonth, draws, from, period, selectedDrawId, to]);
  const periodLabel = selectedDrawId
    ? "งวดที่เลือก"
    : period === "current"
      ? "งวดนี้"
      : period === "compare"
        ? "งวดนี้เทียบงวดที่แล้ว"
        : period === "month"
          ? `${periodDraws.length} งวดใน${monthOptions.find((item) => item.value === activeMonth)?.label ?? "เดือนที่เลือก"}`
          : `${periodDraws.length} งวดในช่วงวันที่ที่เลือก`;
  const rows = useMemo(() => settings.dimension === "draws" ? periodDraws : settings.dimension === "agents" ? agents : prizes, [agents, periodDraws, prizes, settings.dimension]);
  const metricLabel = METRICS.find((item) => item.value === settings.metric)?.label ?? "ข้อมูล";
  const metricIsMoney = !["bills", "items", "winners"].includes(settings.metric);
  const formatMetric = (value: number) => `${metricIsMoney ? MONEY.format(value) : COUNT.format(value)}${metricIsMoney ? " บาท" : ""}`;
  const metricTotal = rows.reduce((total, row) => total + row[settings.metric], 0);
  const metricAverage = rows.length > 0 ? metricTotal / rows.length : 0;
  const metricHighest = rows.reduce<ReportChartDatum | null>((highest, row) => !highest || row[settings.metric] > highest[settings.metric] ? row : highest, null);
  const groupLabel = settings.dimension === "draws" ? "งวด" : settings.dimension === "agents" ? "Agent" : "ประเภทรางวัล";
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
  function reset() { choosePreset(PRESETS[0]!); setPeriod("current"); setSelectedMonth(""); setFrom(""); setTo(""); setDraft(baseSettings(PRESETS[0]!)); setAdvanced(true); }
  function openDrawer() { setDraft(settings); setAdvanced(true); setOpen(true); }
  function refresh() { setRefreshing(true); router.refresh(); window.setTimeout(() => setRefreshing(false), 900); }
  async function exportExcel() {
    if (rows.length === 0 || exporting) return;
    setExporting(true);
    setExportError("");
    try {
      const { downloadReportWorkbook } = await import("@/lib/excel/report-workbook");
      const workbookRows = rows.map((row) => ({
        date: row.date ? new Date(`${row.date}T00:00:00`) : null,
        code: row.code,
        name: row.name,
        gross: row.gross,
        payout: row.payout,
        commission: row.commission,
        net: row.net,
        bills: row.bills,
        items: row.items,
        winners: row.winners,
      }));
      const safePeriod = (settings.dimension === "draws" ? periodLabel : groupLabel).replace(/[\\/:*?"<>|]/g, "-");
      downloadReportWorkbook({
        title: presetId === "custom" ? customTitle : preset.title,
        periodLabel: settings.dimension === "draws" ? periodLabel : `ข้อมูลตาม${groupLabel}`,
        groupLabel,
        rows: workbookRows,
      }, `รายงาน-${safePeriod}.xlsx`);
    } catch {
      setExportError("สร้างไฟล์ Excel ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setExporting(false);
    }
  }

  return <section className="report-dashboard" aria-labelledby="report-dashboard-heading">
    <header className="report-dashboard-heading"><div><span className="report-kicker">ANALYTICS DASHBOARD</span><h2 id="report-dashboard-heading">สำรวจข้อมูลจากกราฟ</h2><p>เลือกหัวข้อที่สนใจ ระบบจัดกราฟและข้อมูลให้ทันที</p></div><div className="report-dashboard-heading-actions"><button type="button" onClick={refresh} disabled={refreshing}>{refreshing ? "กำลังรีเฟรช…" : "↻ รีเฟรช"}</button><button type="button" onClick={exportExcel} disabled={exporting || rows.length === 0}>{exporting ? "กำลังสร้าง Excel…" : "↓ ดาวน์โหลด Excel"}</button></div></header>
    <div className="report-dashboard-mini-kpis" aria-label="สรุปข้อมูลการขาย"><div><small>จำนวนบิล</small><strong>{COUNT.format(summary.billCount)}</strong></div><div><small>เฉลี่ยต่อรายการ</small><strong>{summary.itemCount ? MONEY.format(summary.gross / summary.itemCount) : "0.00"}&nbsp;บาท</strong></div><div><small>ยอดขายสูงสุด · {draws.length} งวดล่าสุด</small><strong>{MONEY.format(Math.max(0, ...draws.map((draw) => draw.gross)))}&nbsp;บาท</strong></div><div><small>Agent ที่มีรายการขาย</small><strong>{COUNT.format(agents.filter((agent) => agent.bills > 0).length)}</strong></div></div>
    <div className="report-dashboard-presets" aria-label="กราฟสำเร็จรูป"><span>อยากดูเรื่องไหน</span><div>{availablePresets.slice(0, 4).map((item) => <button type="button" key={item.id} aria-pressed={presetId === item.id} onClick={() => choosePreset(item)}>{item.title}</button>)}{availablePresets.length > 4 && <select aria-label="เลือกกราฟเพิ่มเติม" value={availablePresets.slice(4).some((item) => item.id === presetId) ? presetId : ""} onChange={(event) => { const next = availablePresets.find((item) => item.id === event.target.value); if (next) choosePreset(next); }}><option value="">กราฟเพิ่มเติม…</option>{availablePresets.slice(4).map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select>}</div></div>
    <div className="report-dashboard-chart-panel"><div className="report-dashboard-chart-heading"><div><span className="report-kicker">{presetId === "custom" ? "CUSTOM VIEW" : "กราฟสำเร็จรูป"}</span><h3>{presetId === "custom" ? customTitle : preset.title}</h3><p>{presetId === "custom" ? "กำลังแสดงค่าที่ปรับแต่ง" : preset.description}{settings.dimension === "draws" ? ` · ${periodLabel}` : ""}</p></div><div className="report-dashboard-chart-actions"><label>รูปแบบกราฟ<select aria-label="เปลี่ยนรูปแบบกราฟ" value={settings.kind} onChange={(event) => chooseKind(event.target.value as DashboardChartKind)}>{compatibleKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><button ref={triggerRef} type="button" onClick={openDrawer}>⚙ ปรับแต่งกราฟ</button><button type="button" onClick={reset}>คืนค่าเริ่มต้น</button></div></div>
      {settings.dimension === "draws" && <div className="report-dashboard-period report-dashboard-quick-actions" role="group" aria-label="ปุ่มลัดสำหรับเจ้าของกิจการและพนักงานบัญชี"><span><b>ปุ่มลัด</b><small>เจ้าของกิจการ / บัญชี</small></span><button type="button" aria-pressed={period === "current"} disabled={Boolean(selectedDrawId)} onClick={() => { setPeriod("current"); setSelected(null); }}>งวดนี้</button><button type="button" aria-pressed={period === "compare"} disabled={Boolean(selectedDrawId)} onClick={() => { setPeriod("compare"); setSelected(null); }}>เทียบงวดก่อน</button><button type="button" aria-pressed={period === "month"} disabled={Boolean(selectedDrawId) || monthOptions.length === 0} onClick={() => { setPeriod("month"); setSelected(null); }}>เดือนล่าสุด</button><label className={`report-dashboard-month${period === "month" ? " is-active" : ""}`}><span className="sr-only">เลือกเดือนอื่น</span><select aria-label="เลือกเดือนอื่นที่ต้องการดู" value={period === "month" ? activeMonth : ""} disabled={Boolean(selectedDrawId) || monthOptions.length === 0} onChange={(event) => { setSelectedMonth(event.target.value); setPeriod("month"); setSelected(null); }}><option value="">เลือกเดือนอื่น…</option>{monthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button type="button" aria-pressed={period === "custom"} disabled={Boolean(selectedDrawId)} onClick={() => { setPeriod("custom"); setSelected(null); }}>เลือกช่วงวันที่</button><button className="report-dashboard-quick-export" type="button" onClick={exportExcel} disabled={exporting || rows.length === 0}>{exporting ? "กำลังสร้าง…" : "ดาวน์โหลด Excel"}</button>{period === "custom" && !selectedDrawId && <div className="report-dashboard-dates"><DateRangePicker startLabel="ตั้งแต่วันที่" endLabel="ถึงวันที่" startPlaceholder="เลือกวันเริ่มต้น" endPlaceholder="เลือกวันสิ้นสุด" startDate={from} endDate={to} onChange={({ startDate, endDate }) => { setFrom(startDate); setTo(endDate); setSelected(null); }} /></div>}{selectedDrawId && <small>กำลังดูงวดที่เลือกด้านบน</small>}</div>}
      <div className="report-dashboard-visual-grid">
        <div className="report-dashboard-visual-main">
          {matrixError && settings.kind === "stacked" ? <div className="report-dashboard-empty" role="alert">{matrixError} <button type="button" onClick={() => setMatrixError("")}>ลองอีกครั้ง</button></div> : <ReportsDashboardChart kind={settings.kind} rows={rows} metric={settings.metric} dimension={settings.dimension} cells={matrix ?? undefined} showGrid={settings.showGrid} showLegend={settings.showLegend} min={settings.min === "" ? undefined : Number(settings.min)} max={settings.max === "" ? undefined : Number(settings.max)} onSelect={setSelected} />}
          {selected && <div className="report-dashboard-selection" aria-live="polite"><b>{selected.name}</b><span>ยอดขาย {MONEY.format(selected.gross)} บาท</span><span>จำนวนบิล {COUNT.format(selected.bills)}</span>{selected.href && <a href={selected.href}>ดูรายละเอียด →</a>}</div>}
        </div>
        <aside className="report-dashboard-quick-summary" aria-label="สรุปข้อมูลจากกราฟ" aria-live="polite">
          <header><span className="report-kicker">ข้อมูลคร่าว ๆ</span><h4>{metricLabel}</h4><p>{settings.dimension === "draws" ? periodLabel : `แยกตาม${groupLabel}`}</p></header>
          <dl>
            <div><dt>ข้อมูลที่แสดง</dt><dd>{COUNT.format(rows.length)} {groupLabel}</dd></div>
            <div><dt>{metricLabel}รวม</dt><dd>{formatMetric(metricTotal)}</dd></div>
            <div><dt>เฉลี่ยต่อ{groupLabel}</dt><dd>{formatMetric(metricAverage)}</dd></div>
            <div><dt>สูงสุด</dt><dd>{metricHighest ? formatMetric(metricHighest[settings.metric]) : "—"}<small>{metricHighest?.name ?? "ยังไม่มีข้อมูล"}</small></dd></div>
          </dl>
          <button type="button" onClick={exportExcel} disabled={exporting || rows.length === 0}>{exporting ? "กำลังสร้างไฟล์…" : "ดาวน์โหลดรายละเอียด Excel"}</button>
          <small>ไฟล์รวมข้อมูลตัวเลขทั้งหมดตามตัวเลือกปัจจุบัน</small>
          {exportError && <p role="alert">{exportError}</p>}
        </aside>
      </div>
    </div>
    {open && createPortal(<div className="report-dashboard-drawer-backdrop" onClick={() => setOpen(false)}><aside ref={drawerRef} className={`report-dashboard-drawer${advanced ? " report-dashboard-drawer--advanced" : ""}`} role="dialog" aria-modal="true" aria-labelledby="report-dashboard-drawer-heading" onClick={(event) => event.stopPropagation()}><header><div><span className="report-kicker">CHART SETTINGS</span><h2 id="report-dashboard-drawer-heading">ปรับแต่งกราฟ</h2><p>เปลี่ยนเท่าที่ต้องการ แล้วกดใช้การตั้งค่า</p></div><button type="button" aria-label="ปิดการตั้งค่ากราฟ" onClick={() => setOpen(false)}>×</button></header><div className="report-dashboard-drawer-tabs"><button type="button" aria-pressed={!advanced} onClick={() => setAdvanced(false)}>ตั้งค่าทั่วไป</button><button type="button" aria-pressed={advanced} onClick={() => setAdvanced(true)}>กำหนดแกน X/Y</button></div>{advanced ? <div className="report-dashboard-drawer-body report-dashboard-drawer-body--advanced"><LazyCustomChartBuilder /></div> : <><div className="report-dashboard-drawer-body"><label>รูปแบบกราฟ<select value={draft.kind} onChange={(event) => { const kind = event.target.value as DashboardChartKind; setDraft((current) => ({ ...current, kind, dimension: kind === "scatter" ? "agents" : kind === "stacked" || kind === "combo" || kind === "area" ? "draws" : kind === "donut" || kind === "pie" ? current.dimension === "prizes" ? "prizes" : "agents" : current.dimension, metric: ["scatter", "combo", "stacked", "donut", "pie"].includes(kind) ? "gross" : current.metric })); }}>{compatibleKinds.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{!["scatter", "stacked", "combo"].includes(draft.kind) && <label>กลุ่มข้อมูล<select value={draft.dimension} onChange={(event) => setDraft({ ...draft, dimension: event.target.value as Dimension, metric: event.target.value === "prizes" && !["gross", "payout", "items", "winners"].includes(draft.metric) ? "gross" : draft.metric })}><option value="draws">รายงวด</option><option value="agents">ราย Agent</option><option value="prizes">ตามประเภทรางวัล</option></select></label>}{!["scatter", "stacked", "combo"].includes(draft.kind) && <label>ตัวชี้วัด<select value={draft.metric} onChange={(event) => setDraft({ ...draft, metric: event.target.value as ReportMetric })}>{METRICS.filter((item) => draft.dimension !== "prizes" || ["gross", "payout", "items", "winners"].includes(item.value)).map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}{draft.kind !== "donut" && draft.kind !== "pie" && draft.kind !== "scatter" && <div className="report-dashboard-range"><span>ช่วงค่าแกน Y <small>เว้นว่างเพื่อใช้ค่าอัตโนมัติ</small></span><label>Min<input type="number" inputMode="decimal" value={draft.min} onChange={(event) => setDraft({ ...draft, min: event.target.value })} /></label><label>Max<input type="number" inputMode="decimal" value={draft.max} onChange={(event) => setDraft({ ...draft, max: event.target.value })} /></label></div>}{!rangeValid && <p role="alert" className="report-dashboard-validation">Max ต้องมากกว่า Min</p>}<label className="report-dashboard-toggle"><input type="checkbox" checked={draft.showLegend} onChange={(event) => setDraft({ ...draft, showLegend: event.target.checked })} />แสดงคำอธิบายสี</label><label className="report-dashboard-toggle"><input type="checkbox" checked={draft.showGrid} onChange={(event) => setDraft({ ...draft, showGrid: event.target.checked })} />แสดงเส้นตาราง</label><p className="report-dashboard-drawer-hint">หากต้องเลือกงวดหรือ Agent แยกกันในแต่ละแกน ใช้แท็บ “กำหนดแกน X/Y”</p></div><footer><button type="button" onClick={() => setOpen(false)}>ยกเลิก</button><button type="button" onClick={() => setDraft(baseSettings(PRESETS[0]!))}>คืนค่าเริ่มต้น</button><button type="button" disabled={!rangeValid} onClick={() => { setSettings(draft); setPresetId("custom"); setOpen(false); setSelected(null); }}>ใช้การตั้งค่า</button></footer></>}</aside></div>, document.body)}
  </section>;
}

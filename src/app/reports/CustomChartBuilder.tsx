"use client";

import { useEffect, useMemo, useState } from "react";
import { DateRangePicker } from "@/components/calendar";
import { AppDropdown } from "../AppDropdown";
import { ChartAxisSettings } from "./ChartAxisSettings";
import { ChartTypeSelector } from "./ChartTypeSelector";
import { CustomChartPreview } from "./CustomChartPreview";
import {
  CHART_COLORS,
  CHART_TYPES,
  FIELD_META,
  defaultChartSettings,
  normalizeForKind,
  type AxisConfig,
  type ChartMatrixCell,
  type CustomChartKind,
  type CustomChartSettings,
  type NumberFormat,
  type SortOrder,
} from "./CustomChartTypes";
import type { ReportMetric } from "./ReportChart";

export type { ChartMatrixCell } from "./CustomChartTypes";

const SAVED_SETTINGS_KEY = "lottery-report-chart-settings-v2";
const DATE = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Bangkok" });

function validRange(axis: AxisConfig) {
  if (axis.range !== "custom" || FIELD_META[axis.field].kind === "time") return true;
  return axis.min.trim() !== "" && axis.max.trim() !== "" && Number.isFinite(Number(axis.min)) && Number.isFinite(Number(axis.max)) && Number(axis.min) < Number(axis.max);
}

function MultiFilter({ title, choices, selected, onToggle }: { title: string; choices: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void }) {
  return <fieldset className="chart-filter-multi"><legend>{title}</legend><div className="chart-filter-selected">{selected.length ? <>{selected.slice(0, 4).map((id) => <span key={id}>{choices.find((choice) => choice.id === id)?.label ?? id}<button type="button" aria-label={`ลบ ${id}`} onClick={() => onToggle(id)}>×</button></span>)}{selected.length > 4 && <small>+{selected.length - 4} รายการ</small>}</> : <small>ทั้งหมด</small>}</div><div className="chart-filter-options">{choices.map((choice) => <label key={choice.id}><input type="checkbox" checked={selected.includes(choice.id)} onChange={() => onToggle(choice.id)} />{choice.label}</label>)}</div></fieldset>;
}

function ChartAdvancedSettings({ settings, draws, agents, onChange }: { settings: CustomChartSettings; draws: { id: string; label: string }[]; agents: { id: string; label: string }[]; onChange: (settings: CustomChartSettings) => void }) {
  const filters = settings.filters;
  const updateFilters = (next: Partial<typeof filters>) => onChange({ ...settings, filters: { ...filters, ...next } });
  const toggle = (key: "drawIds" | "agentIds", id: string) => updateFilters({ [key]: filters[key].includes(id) ? filters[key].filter((value) => value !== id) : [...filters[key], id] });
  return <section className="chart-settings-step" aria-labelledby="chart-filter-step">
    <header className="chart-settings-step-heading"><span>3</span><div><h3 id="chart-filter-step">ตัวกรองและการแสดงผล</h3><p>ไม่จำเป็นต้องตั้งค่าทุกอย่าง เปิดเฉพาะเมื่ออยากเจาะข้อมูลเพิ่มเติม</p></div></header>
    <details className="chart-advanced-settings"><summary><span>⚙</span><div><strong>Advanced Settings</strong><small>ช่วงวันที่ · งวด · Agent · การเรียงลำดับ · สีและป้ายกำกับ</small></div><i>⌄</i></summary><div className="chart-advanced-settings-body">
      <div className="chart-filter-date"><DateRangePicker startLabel="ตั้งแต่" endLabel="ถึงวันที่" startPlaceholder="เลือกวันเริ่มต้น" endPlaceholder="เลือกวันสิ้นสุด" startDate={filters.from} endDate={filters.to} onChange={({ startDate, endDate }) => updateFilters({ from: startDate, to: endDate })} /></div>
      <div className="chart-filter-columns"><MultiFilter title="เลือกงวด" choices={draws} selected={filters.drawIds} onToggle={(id) => toggle("drawIds", id)} /><MultiFilter title="เลือก Agent" choices={agents} selected={filters.agentIds} onToggle={(id) => toggle("agentIds", id)} /></div>
      <div className="chart-display-settings">
        <label><span>การเรียงลำดับ</span><AppDropdown value={filters.sort} onValueChange={(value) => updateFilters({ sort: value as SortOrder })} ariaLabel="การเรียงลำดับกราฟ" options={[{ value: "time-asc", label: "ตามเวลาเก่า → ใหม่" }, { value: "time-desc", label: "ตามเวลาใหม่ → เก่า" }, { value: "value-desc", label: "ค่ามาก → น้อย" }, { value: "value-asc", label: "ค่าน้อย → มาก" }]} /></label>
        <label><span>รูปแบบตัวเลข</span><AppDropdown value={filters.numberFormat} onValueChange={(value) => updateFilters({ numberFormat: value as NumberFormat })} ariaLabel="รูปแบบตัวเลข" options={[{ value: "compact", label: "ย่อ K / M บนแกน" }, { value: "full", label: "ตัวเลขเต็ม" }]} /></label>
        <fieldset className="chart-color-picker"><legend>สีหลักของกราฟ</legend>{CHART_COLORS.map((color) => <button key={color} type="button" style={{ background: color }} aria-label={`เลือกสี ${color}`} aria-pressed={filters.color === color} onClick={() => updateFilters({ color })} />)}</fieldset>
        <div className="chart-display-toggles"><label><input type="checkbox" checked={filters.showLegend} onChange={(event) => updateFilters({ showLegend: event.target.checked })} />คำอธิบายสี</label><label><input type="checkbox" checked={filters.showLabels} onChange={(event) => updateFilters({ showLabels: event.target.checked })} />ตัวเลขบนกราฟ</label><label><input type="checkbox" checked={filters.showGrid} onChange={(event) => updateFilters({ showGrid: event.target.checked })} />เส้นตาราง</label></div>
      </div>
    </div></details>
  </section>;
}

export function CustomChartBuilder({ cells, initialXMetric = "gross", initialYMetric, onCancel }: { cells: ChartMatrixCell[]; initialXMetric?: ReportMetric; initialYMetric?: ReportMetric; onCancel?: () => void }) {
  const initialMetric = initialYMetric ?? initialXMetric;
  const [settings, setSettings] = useState<CustomChartSettings>(() => defaultChartSettings(initialMetric));
  const [savedMessage, setSavedMessage] = useState("");
  const draws = useMemo(() => [...new Map(cells.map((cell) => [cell.drawId, { id: cell.drawId, label: `${DATE.format(new Date(cell.cutoffAt))} · ${cell.drawName}`, date: cell.cutoffAt }])).values()].sort((a, b) => b.date.localeCompare(a.date)), [cells]);
  const agents = useMemo(() => [...new Map(cells.map((cell) => [cell.agentId, { id: cell.agentId, label: `${cell.agentCode} · ${cell.agentName}` }])).values()].sort((a, b) => a.label.localeCompare(b.label, "th")), [cells]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as CustomChartSettings;
      if (CHART_TYPES.some((item) => item.value === saved.kind) && saved.x?.field && saved.y?.field && saved.filters) setSettings(saved);
    } catch { /* ใช้ค่าเริ่มต้นเมื่อข้อมูลที่บันทึกไว้ไม่สมบูรณ์ */ }
  }, []);

  const filteredCount = useMemo(() => cells.filter((cell) => (!settings.filters.drawIds.length || settings.filters.drawIds.includes(cell.drawId)) && (!settings.filters.agentIds.length || settings.filters.agentIds.includes(cell.agentId)) && (!settings.filters.from || cell.cutoffDate >= settings.filters.from) && (!settings.filters.to || cell.cutoffDate <= settings.filters.to)).length, [cells, settings.filters]);
  const valid = validRange(settings.x) && validRange(settings.y) && (!settings.filters.from || !settings.filters.to || settings.filters.from <= settings.filters.to);
  const reset = () => { setSettings(defaultChartSettings(initialMetric)); setSavedMessage(""); };
  const save = () => { localStorage.setItem(SAVED_SETTINGS_KEY, JSON.stringify(settings)); setSavedMessage("บันทึกการตั้งค่าแล้ว"); };
  const cancel = () => {
    if (onCancel) return onCancel();
    const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="ปิดการตั้งค่ากราฟ"]');
    if (closeButton) closeButton.click(); else reset();
  };

  return <section className="custom-chart-builder custom-chart-builder--guided" aria-labelledby="custom-chart-heading">
    <header className="custom-chart-guided-header"><div><span>CHART BUILDER</span><h2 id="custom-chart-heading">ปรับแต่งกราฟ</h2><p>เลือกชนิดกราฟและข้อมูลทีละขั้น Preview ด้านล่างจะอัปเดตให้ทันที</p></div><div className="custom-chart-guided-summary"><strong>{CHART_TYPES.find((item) => item.value === settings.kind)?.label}</strong><span>{FIELD_META[settings.x.field].shortLabel} → {FIELD_META[settings.y.field].shortLabel}</span><small>{filteredCount.toLocaleString("th-TH")} คู่ งวด × Agent</small></div></header>
    <nav className="chart-step-nav" aria-label="ขั้นตอนการตั้งค่ากราฟ"><span className="is-active"><b>1</b>รูปแบบ</span><i /><span className="is-active"><b>2</b>ข้อมูล X/Y</span><i /><span><b>3</b>ตัวกรอง</span></nav>
    <ChartTypeSelector value={settings.kind} onChange={(kind: CustomChartKind) => setSettings((current) => normalizeForKind(current, kind))} />
    <ChartAxisSettings kind={settings.kind} x={settings.x} y={settings.y} onXChange={(x) => setSettings({ ...settings, x })} onYChange={(y) => setSettings({ ...settings, y })} />
    <ChartAdvancedSettings settings={settings} draws={draws} agents={agents} onChange={setSettings} />
    {!valid && <p className="custom-chart-error" role="alert">ช่วงค่า Min/Max หรือช่วงวันที่ไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง</p>}
    <div className="custom-chart-live-preview"><CustomChartPreview cells={cells} settings={settings} /></div>
    <footer className="custom-chart-guided-actions"><div>{savedMessage && <span role="status">✓ {savedMessage}</span>}</div><button type="button" onClick={cancel}>ยกเลิก</button><button type="button" onClick={reset}>คืนค่าเริ่มต้น</button><button type="button" className="custom-chart-save" disabled={!valid} onClick={save}>บันทึกการตั้งค่า</button></footer>
  </section>;
}

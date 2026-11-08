"use client";

import { AppDropdown } from "../AppDropdown";
import {
  FIELD_META,
  TIME_GROUPS,
  X_FIELDS,
  Y_FIELDS,
  calculationOptions,
  isNumeric,
  isTemporal,
  type AxisConfig,
  type CustomChartKind,
  type DataField,
  type TimeGrouping,
  type Calculation,
} from "./CustomChartTypes";

function AxisPanel({ side, axis, kind, onChange }: { side: "X" | "Y"; axis: AxisConfig; kind: CustomChartKind; onChange: (axis: AxisConfig) => void }) {
  const allowed = side === "X"
    ? X_FIELDS.filter((field) => (kind === "scatter" ? FIELD_META[field].kind !== "category" : kind === "pie" || kind === "donut" ? FIELD_META[field].kind === "category" : true))
    : Y_FIELDS.filter((field) => kind === "scatter" || isNumeric(field));
  const temporal = isTemporal(axis.field);
  const calculations = kind === "scatter" ? [{ value: "raw", label: "ใช้ค่ารายจุด (ไม่รวมข้อมูล)" }] : calculationOptions(axis.field);
  return <section className={`chart-axis-panel chart-axis-panel--${side.toLowerCase()}`} aria-labelledby={`chart-axis-${side}`}>
    <header><span>{side}</span><div><h4 id={`chart-axis-${side}`}>แกน {side}</h4><small>{side === "X" ? "สิ่งที่ใช้แบ่งหรือเรียงข้อมูล" : "ค่าที่ต้องการวัดและเปรียบเทียบ"}</small></div></header>
    <div className="chart-axis-panel-fields">
      <label><span>ข้อมูลที่ใช้</span><AppDropdown value={axis.field} onValueChange={(value) => {
        const field = value as DataField;
        const calculation = (kind === "scatter" ? "raw" : calculationOptions(field)[0]!.value) as Calculation;
        onChange({ ...axis, field, calculation });
      }} ariaLabel={`ข้อมูลแกน ${side}`} options={allowed.map((field) => ({ value: field, label: FIELD_META[field].label }))} /></label>
      {temporal && <label><span>การจัดกลุ่มเวลา</span><AppDropdown value={axis.grouping} onValueChange={(value) => onChange({ ...axis, grouping: value as TimeGrouping })} ariaLabel={`การจัดกลุ่มเวลาแกน ${side}`} options={TIME_GROUPS} /></label>}
      <label><span>วิธีคำนวณ</span><AppDropdown value={axis.calculation} onValueChange={(value) => onChange({ ...axis, calculation: value as Calculation })} ariaLabel={`วิธีคำนวณแกน ${side}`} options={calculations} /></label>
      {temporal && <p className="chart-axis-hint">วันเวลาจะแสดงตามเขตเวลา Asia/Bangkok และไม่ถูกนำไปบวกหรือเฉลี่ย</p>}
      {(kind === "scatter" || (side === "Y" && isNumeric(axis.field))) && <details className="chart-axis-range"><summary>กำหนดช่วงแกน</summary><div><label><span>ช่วงค่า</span><AppDropdown value={axis.range} onValueChange={(value) => onChange({ ...axis, range: value as "auto" | "custom" })} ariaLabel={`ช่วงค่าแกน ${side}`} options={[{ value: "auto", label: "อัตโนมัติ" }, { value: "custom", label: "กำหนดเอง" }]} /></label>{axis.range === "custom" && !temporal && <div className="chart-axis-minmax"><label><span>Min</span><input type="number" inputMode="decimal" value={axis.min} onChange={(event) => onChange({ ...axis, min: event.target.value })} /></label><label><span>Max</span><input type="number" inputMode="decimal" value={axis.max} onChange={(event) => onChange({ ...axis, max: event.target.value })} /></label></div>}</div></details>}
    </div>
  </section>;
}

export function ChartAxisSettings({ kind, x, y, onXChange, onYChange }: { kind: CustomChartKind; x: AxisConfig; y: AxisConfig; onXChange: (axis: AxisConfig) => void; onYChange: (axis: AxisConfig) => void }) {
  return <section className="chart-settings-step" aria-labelledby="chart-axis-step">
    <header className="chart-settings-step-heading"><span>2</span><div><h3 id="chart-axis-step">เลือกข้อมูลแกน X และ Y</h3><p>ตัวเลือกจะเปลี่ยนตามชนิดกราฟ เพื่อป้องกันการตั้งค่าที่ไม่มีความหมาย</p></div></header>
    <div className="chart-axis-panels"><AxisPanel side="X" axis={x} kind={kind} onChange={onXChange} /><AxisPanel side="Y" axis={y} kind={kind} onChange={onYChange} /></div>
  </section>;
}

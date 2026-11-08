import type { ReportMetric } from "./ReportChart";

export type ChartMatrixCell = {
  drawId: string;
  drawName: string;
  drawStatus?: string;
  cutoffAt: string;
  cutoffDate: string;
  agentId: string;
  agentCode: string;
  agentName: string;
  agentStatus?: string;
  gross: number;
  payout: number;
  commission: number;
  net: number;
  bills: number;
  items: number;
  winners: number;
};

export type CustomChartKind = "line" | "bar" | "horizontal-bar" | "area" | "stacked" | "pie" | "donut" | "scatter" | "combo";
export type DataField = "cutoffAt" | "cutoffDate" | "cutoffTime" | "draw" | "agent" | "drawStatus" | "agentStatus" | ReportMetric;
export type Calculation = "sum" | "average" | "count" | "max" | "min" | "raw";
export type TimeGrouping = "auto" | "hour" | "day" | "week" | "month" | "year";
export type SortOrder = "time-asc" | "time-desc" | "value-desc" | "value-asc";
export type NumberFormat = "compact" | "full";

export type AxisConfig = {
  field: DataField;
  calculation: Calculation;
  grouping: TimeGrouping;
  range: "auto" | "custom";
  min: string;
  max: string;
};

export type ChartFilters = {
  drawIds: string[];
  agentIds: string[];
  from: string;
  to: string;
  sort: SortOrder;
  color: string;
  showLegend: boolean;
  showLabels: boolean;
  showGrid: boolean;
  numberFormat: NumberFormat;
};

export type CustomChartSettings = {
  kind: CustomChartKind;
  x: AxisConfig;
  y: AxisConfig;
  filters: ChartFilters;
};

type FieldMeta = { label: string; shortLabel: string; kind: "number" | "time" | "category"; money?: boolean };

export const FIELD_META: Record<DataField, FieldMeta> = {
  cutoffAt: { label: "วันและเวลา", shortLabel: "วันเวลา", kind: "time" },
  cutoffDate: { label: "วันที่", shortLabel: "วันที่", kind: "time" },
  cutoffTime: { label: "เวลา", shortLabel: "เวลา", kind: "time" },
  draw: { label: "งวด", shortLabel: "งวด", kind: "category" },
  agent: { label: "Agent", shortLabel: "Agent", kind: "category" },
  drawStatus: { label: "สถานะงวด", shortLabel: "สถานะงวด", kind: "category" },
  agentStatus: { label: "สถานะ Agent", shortLabel: "สถานะ Agent", kind: "category" },
  gross: { label: "ยอดขาย", shortLabel: "ยอดขาย", kind: "number", money: true },
  payout: { label: "จ่ายรางวัล", shortLabel: "จ่ายรางวัล", kind: "number", money: true },
  commission: { label: "คอมมิชชัน", shortLabel: "คอมมิชชัน", kind: "number", money: true },
  net: { label: "ยอดสุทธิ", shortLabel: "ยอดสุทธิ", kind: "number", money: true },
  bills: { label: "จำนวนบิล", shortLabel: "บิล", kind: "number" },
  items: { label: "จำนวนรายการ", shortLabel: "รายการ", kind: "number" },
  winners: { label: "รายการถูกรางวัล", shortLabel: "ถูกรางวัล", kind: "number" },
};

export const X_FIELDS: DataField[] = ["cutoffAt", "cutoffDate", "cutoffTime", "draw", "agent", "drawStatus", "agentStatus", "gross", "net", "payout", "commission", "bills", "items", "winners"];
export const Y_FIELDS: DataField[] = ["gross", "net", "payout", "commission", "bills", "items", "winners", "cutoffAt", "cutoffDate", "cutoffTime"];

export const CHART_TYPES: { value: CustomChartKind; label: string; description: string; icon: string }[] = [
  { value: "line", label: "กราฟเส้น", description: "ดูแนวโน้มตามเวลา", icon: "╱" },
  { value: "bar", label: "กราฟแท่ง", description: "เปรียบเทียบแต่ละกลุ่ม", icon: "▥" },
  { value: "horizontal-bar", label: "แท่งแนวนอน", description: "อ่านชื่อหมวดหมู่ยาว ๆ", icon: "☷" },
  { value: "area", label: "กราฟพื้นที่", description: "ดูแนวโน้มและปริมาณ", icon: "◿" },
  { value: "stacked", label: "กราฟแท่งซ้อน", description: "แยกสัดส่วนตาม Agent", icon: "▤" },
  { value: "pie", label: "กราฟวงกลม", description: "ดูสัดส่วนของหมวดหมู่", icon: "◕" },
  { value: "donut", label: "กราฟโดนัท", description: "ดูสัดส่วนพร้อมยอดรวม", icon: "◉" },
  { value: "scatter", label: "กราฟกระจาย", description: "หาความสัมพันธ์ของสองค่า", icon: "⠿" },
  { value: "combo", label: "กราฟผสม", description: "เทียบยอดเงินกับจำนวนบิล", icon: "▥╱" },
];

export const CALCULATIONS: { value: Calculation; label: string }[] = [
  { value: "sum", label: "ผลรวม" },
  { value: "average", label: "ค่าเฉลี่ย" },
  { value: "count", label: "จำนวนรายการ" },
  { value: "max", label: "ค่าสูงสุด" },
  { value: "min", label: "ค่าต่ำสุด" },
];

export const TIME_GROUPS: { value: TimeGrouping; label: string }[] = [
  { value: "auto", label: "จัดกลุ่มอัตโนมัติ" },
  { value: "hour", label: "รายชั่วโมง" },
  { value: "day", label: "รายวัน" },
  { value: "week", label: "รายสัปดาห์" },
  { value: "month", label: "รายเดือน" },
  { value: "year", label: "รายปี" },
];

export const CHART_COLORS = ["#1677ff", "#0f9f9a", "#7657d5", "#f0a31a", "#df5b70"] as const;

export function defaultChartSettings(yField: DataField = "gross"): CustomChartSettings {
  return {
    kind: "line",
    x: { field: "cutoffAt", calculation: "raw", grouping: "auto", range: "auto", min: "", max: "" },
    y: { field: yField, calculation: "sum", grouping: "auto", range: "auto", min: "", max: "" },
    filters: { drawIds: [], agentIds: [], from: "", to: "", sort: "time-asc", color: CHART_COLORS[0], showLegend: true, showLabels: false, showGrid: true, numberFormat: "compact" },
  };
}

export const isTemporal = (field: DataField) => FIELD_META[field].kind === "time";
export const isNumeric = (field: DataField) => FIELD_META[field].kind === "number";
export const isCategorical = (field: DataField) => FIELD_META[field].kind === "category";

export function calculationOptions(field: DataField) {
  if (isTemporal(field)) return [{ value: "raw", label: "ใช้ค่าตามเวลา (ไม่คำนวณ)" }];
  if (!isNumeric(field)) return [{ value: "count", label: "นับจำนวน" }];
  return CALCULATIONS;
}

export function normalizeForKind(settings: CustomChartSettings, kind: CustomChartKind): CustomChartSettings {
  const next = { ...settings, kind, x: { ...settings.x }, y: { ...settings.y } };
  if (kind === "pie" || kind === "donut") {
    if (!isCategorical(next.x.field)) next.x.field = "agent";
    if (!isNumeric(next.y.field)) next.y = { ...next.y, field: "gross", calculation: "sum" };
  } else if (kind === "scatter") {
    if (isCategorical(next.x.field)) next.x = { ...next.x, field: "gross", calculation: "raw" };
    if (!isNumeric(next.y.field) && !isTemporal(next.y.field)) next.y = { ...next.y, field: "bills", calculation: "raw" };
    if (next.x.field === next.y.field) next.y = { ...next.y, field: next.x.field === "bills" ? "gross" : "bills", calculation: "raw" };
    next.x.calculation = "raw";
    next.y.calculation = "raw";
  } else if (kind === "stacked" || kind === "combo" || kind === "line" || kind === "area") {
    if (!isTemporal(next.x.field) && !isCategorical(next.x.field)) next.x = { ...next.x, field: "cutoffAt", grouping: "auto", calculation: "raw" };
    if (!isNumeric(next.y.field)) next.y = { ...next.y, field: "gross", calculation: "sum" };
    if (next.y.calculation === "raw") next.y.calculation = "sum";
  } else if (!isNumeric(next.y.field)) {
    next.y = { ...next.y, field: "gross", calculation: "sum" };
  } else if (next.y.calculation === "raw") {
    next.y.calculation = "sum";
  }
  return next;
}

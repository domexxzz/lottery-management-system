import { readBetTab, type BetTab } from "./betting";

/** ค่าตัวกรองของหน้าประวัติรายการ ใช้ร่วมกันทั้งหน้าเว็บและไฟล์ CSV */
export type HistoryParams = {
  q?: string;
  tab?: string;
  lottery?: string;
  from?: string;
  to?: string;
  draw?: string;
  agent?: string;
  scope?: string;
  page?: string;
};

/**
 * ขอบเขตงวดของหน้าประวัติ
 * - current: งวดที่ยังปิดงานไม่เสร็จ (เปิดรับ / ปิดรับแล้ว / รอผล) เป็นค่าเริ่มต้น
 * - past: งวดที่จบแล้ว (ตรวจผลแล้ว / ปิดบัญชีแล้ว)
 * - all: ทุกงวด
 */
export type DrawScope = "current" | "past" | "all";
export const DRAW_SCOPES: readonly DrawScope[] = ["current", "past", "all"];

export function readDrawScope(value: string | undefined): DrawScope {
  return value === "past" || value === "all" ? value : "current";
}

export type ParsedHistoryFilter = {
  tab: BetTab;
  lotteryType: "THAI_GOVERNMENT" | undefined;
  query: string;
  from: string;
  to: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  drawId: string;
  agentId: string;
  scope: DrawScope;
  page: number;
};

/** วันที่แบบ YYYY-MM-DD ตามเวลาไทย เป็นขอบเขตต้นวันหรือท้ายวัน */
export function bangkokBoundary(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseHistoryFilter(params: HistoryParams): ParsedHistoryFilter {
  const page = Number(params.page);
  const from = bangkokBoundary(params.from) ? params.from ?? "" : "";
  const to = bangkokBoundary(params.to) ? params.to ?? "" : "";
  return {
    tab: readBetTab(params.tab),
    lotteryType: params.lottery === "THAI_GOVERNMENT" ? "THAI_GOVERNMENT" : undefined,
    query: (params.q ?? "").trim().slice(0, 80),
    from,
    to,
    dateFrom: bangkokBoundary(from),
    dateTo: bangkokBoundary(to, true),
    drawId: (params.draw ?? "").trim(),
    agentId: (params.agent ?? "").trim(),
    scope: readDrawScope(params.scope),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

/** สร้าง query string ของหน้าประวัติ โดยตัดค่าว่างและค่าเริ่มต้นออก */
export function historyHref(base: string, filter: ParsedHistoryFilter, override: Partial<Record<keyof HistoryParams, string | number>> = {}): string {
  const values: Record<string, string> = {
    tab: filter.tab === "ALL" ? "" : filter.tab,
    q: filter.query,
    lottery: filter.lotteryType ?? "",
    from: filter.from,
    to: filter.to,
    draw: filter.drawId,
    agent: filter.agentId,
    scope: filter.scope === "current" ? "" : filter.scope,
    page: filter.page > 1 ? String(filter.page) : "",
  };
  for (const [key, value] of Object.entries(override)) values[key] = String(value);
  if (values.page === "1") values.page = "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

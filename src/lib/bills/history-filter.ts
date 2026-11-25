import { readBetTab, type BetTab } from "./betting";

/** ค่าตัวกรองของหน้าประวัติรายการ ใช้ร่วมกันทั้งหน้าเว็บและไฟล์ CSV */
export type HistoryParams = {
  q?: string;
  tab?: string;
  lottery?: string;
  from?: string;
  to?: string;
  draw?: string;
  /** หลายงวดที่ต้องดูพร้อมกัน เช่น หวยลาว + หวยลาวชุด family เดียวกัน */
  draws?: string;
  agent?: string;
  scope?: string;
  page?: string;
  pageSize?: string;
  sort?: string;
  /** แสดงประวัติเต็มแบบแบ่งหน้า; ค่าเริ่มต้นแสดงเพียง 5 รายการล่าสุด */
  all?: string;
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
  lotteryType: "THAI_GOVERNMENT" | "LAO" | "LAO_SET" | "LAO_COMBINED" | undefined;
  query: string;
  from: string;
  to: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  drawId: string;
  drawIds: string[];
  agentId: string;
  scope: DrawScope;
  page: number;
  pageSize: 10 | 25 | 50 | 100;
  sort: "newest" | "oldest" | "stake_desc" | "payout_desc";
  showAll: boolean;
};

/** วันที่แบบ YYYY-MM-DD ตามเวลาไทย เป็นขอบเขตต้นวันหรือท้ายวัน */
export function bangkokBoundary(value: string | undefined, endOfDay = false): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}+07:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseHistoryFilter(params: HistoryParams): ParsedHistoryFilter {
  const page = Number(params.page);
  const requestedPageSize = Number(params.pageSize);
  const pageSize = ([10, 25, 50, 100] as const).find((value) => value === requestedPageSize) ?? 10;
  const sort = params.sort === "oldest" || params.sort === "stake_desc" || params.sort === "payout_desc" ? params.sort : "newest";
  const from = bangkokBoundary(params.from) ? params.from ?? "" : "";
  const to = bangkokBoundary(params.to) ? params.to ?? "" : "";
  return {
    tab: readBetTab(params.tab),
    lotteryType: params.lottery === "THAI_GOVERNMENT" || params.lottery === "LAO" || params.lottery === "LAO_SET" || params.lottery === "LAO_COMBINED" ? params.lottery : undefined,
    query: (params.q ?? "").trim().slice(0, 80),
    from,
    to,
    dateFrom: bangkokBoundary(from),
    dateTo: bangkokBoundary(to, true),
    drawId: (params.draw ?? "").trim(),
    drawIds: [...new Set((params.draws ?? "").split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_-]{8,64}$/.test(value)))].slice(0, 12),
    agentId: (params.agent ?? "").trim(),
    scope: readDrawScope(params.scope),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    pageSize,
    sort,
    showAll: params.all === "1",
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
    draws: filter.drawIds.join(","),
    agent: filter.agentId,
    scope: filter.scope === "current" ? "" : filter.scope,
    page: filter.page > 1 ? String(filter.page) : "",
    pageSize: filter.pageSize === 10 ? "" : String(filter.pageSize),
    sort: filter.sort === "newest" ? "" : filter.sort,
    all: filter.showAll ? "1" : "",
  };
  for (const [key, value] of Object.entries(override)) values[key] = String(value);
  if (values.page === "1") values.page = "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

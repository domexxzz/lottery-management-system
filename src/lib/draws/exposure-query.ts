import type { ExposureSort, ExposureStatus } from "./number-exposure";

/** พารามิเตอร์ใน URL ของหน้ารายการเลขเต็ม อ่านแบบปลอดภัย ค่าแปลก ๆ ตกไปที่ค่าเริ่มต้น */
export type ExposureParams = {
  drawId: string;
  status: ExposureStatus | "all";
  type: string;
  q: string;
  sort: ExposureSort;
  dir: "asc" | "desc";
  page: number;
};

type RawParams = Record<string, string | string[] | undefined>;

const STATUSES = ["all", "normal", "near", "full"] as const;
const SORTS = ["percent", "used", "remaining", "number"] as const;

/** ทิศทางเริ่มต้นที่เป็นประโยชน์ของแต่ละคอลัมน์: ใช้ไปมากสุด / คงเหลือน้อยสุด ขึ้นก่อน */
export const DEFAULT_DIRECTION: Record<ExposureSort, "asc" | "desc"> = {
  percent: "desc",
  used: "desc",
  remaining: "asc",
  number: "asc",
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseExposureParams(raw: RawParams): ExposureParams {
  const status = first(raw.status);
  const sort = first(raw.sort);
  const parsedSort: ExposureSort = (SORTS as readonly string[]).includes(sort) ? (sort as ExposureSort) : "percent";
  const dir = first(raw.dir);
  const page = Number.parseInt(first(raw.page), 10);
  return {
    drawId: first(raw.drawId).slice(0, 64),
    status: (STATUSES as readonly string[]).includes(status) ? (status as ExposureParams["status"]) : "near",
    type: first(raw.type).slice(0, 64),
    q: first(raw.q).replace(/\D/g, "").slice(0, 6),
    sort: parsedSort,
    dir: dir === "asc" || dir === "desc" ? dir : DEFAULT_DIRECTION[parsedSort],
    page: Number.isFinite(page) && page > 0 ? Math.min(page, 100_000) : 1,
  };
}

/** สร้างลิงก์ของหน้าเดียวกันโดยเปลี่ยนบางค่า ค่าที่เป็นค่าเริ่มต้นไม่ใส่ใน URL */
export function exposureHref(base: ExposureParams, change: Partial<ExposureParams>): string {
  const next = { ...base, ...change };
  // เปลี่ยนตัวกรองหรือการเรียงแล้วกลับไปหน้าแรกเสมอ
  if (!("page" in change)) next.page = 1;
  const params = new URLSearchParams();
  if (next.drawId) params.set("drawId", next.drawId);
  if (next.status !== "all") params.set("status", next.status);
  if (next.type) params.set("type", next.type);
  if (next.q) params.set("q", next.q);
  if (next.sort !== "percent") params.set("sort", next.sort);
  if (next.dir !== DEFAULT_DIRECTION[next.sort]) params.set("dir", next.dir);
  if (next.page > 1) params.set("page", String(next.page));
  const query = params.toString();
  return query ? `/numbers?${query}` : "/numbers";
}

/** เลขหน้าที่จะแสดงในแถบเปลี่ยนหน้า: หน้าแรก หน้าสุดท้าย และรอบหน้าปัจจุบัน */
export function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  const pages = new Set([1, pageCount, page - 1, page, page + 1].filter((value) => value >= 1 && value <= pageCount));
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | "gap")[] = [];
  for (const value of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && value - previous > 1) result.push("gap");
    result.push(value);
  }
  return result;
}

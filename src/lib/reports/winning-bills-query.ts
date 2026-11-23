import { bangkokBoundary } from "@/lib/bills/history-filter";

export type WinningBillsQuery = {
  lottery?: "THAI_GOVERNMENT" | "LAO_COMBINED";
  drawIds: string[];
  dashboardDrawId: string;
  agentId: string;
  from: string;
  to: string;
  dateFrom?: Date;
  dateTo?: Date;
  page: number;
};

type RawQuery = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] ?? "" : value ?? "";

export function parseWinningBillsQuery(raw: RawQuery): WinningBillsQuery {
  const from = bangkokBoundary(first(raw.from)) ? first(raw.from) : "";
  const to = bangkokBoundary(first(raw.to)) ? first(raw.to) : "";
  const page = Number(first(raw.page));
  return {
    lottery: first(raw.lottery) === "THAI_GOVERNMENT" ? "THAI_GOVERNMENT" : first(raw.lottery) === "LAO_COMBINED" ? "LAO_COMBINED" : undefined,
    drawIds: [...new Set(first(raw.draws).split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_-]{8,64}$/.test(value)))].slice(0, 12),
    dashboardDrawId: /^[A-Za-z0-9_-]{8,64}$/.test(first(raw.dashboardDraw)) ? first(raw.dashboardDraw) : "",
    agentId: first(raw.agent).trim().slice(0, 64),
    from,
    to,
    dateFrom: bangkokBoundary(from),
    dateTo: bangkokBoundary(to, true),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
  };
}

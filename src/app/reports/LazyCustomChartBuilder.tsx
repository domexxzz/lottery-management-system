"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CustomChartBuilder } from "./CustomChartBuilder";
import type { ChartFilterChoice, ChartFilters, ChartMatrixCell, ChartMatrixMeta, ChartMatrixResponse } from "./CustomChartTypes";
import type { ReportMetric } from "./ReportChart";

type QueryFilters = Pick<ChartFilters, "drawIds" | "agentIds" | "from" | "to">;
type OptionsResponse = { draws: ChartFilterChoice[]; agents: ChartFilterChoice[] };
const EMPTY_FILTERS: QueryFilters = { drawIds: [], agentIds: [], from: "", to: "" };

function matrixUrl(filters: QueryFilters) {
  const params = new URLSearchParams({ drawLimit: "24", rowLimit: "5000" });
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  for (const drawId of filters.drawIds) params.append("drawIds", drawId);
  for (const agentId of filters.agentIds) params.append("agentIds", agentId);
  return `/api/reports/chart-matrix?${params.toString()}`;
}

export function LazyCustomChartBuilder({ customerBehavior = false, initialXMetric, initialYMetric, onCancel }: { customerBehavior?: boolean; initialXMetric?: ReportMetric; initialYMetric?: ReportMetric; onCancel?: () => void }) {
  const [cells, setCells] = useState<ChartMatrixCell[] | null>(null);
  const [meta, setMeta] = useState<ChartMatrixMeta | undefined>();
  const [options, setOptions] = useState<OptionsResponse>({ draws: [], agents: [] });
  const [filters, setFilters] = useState<QueryFilters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const firstRequest = useRef(true);
  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/reports/chart-options", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`โหลดรายการตัวกรองไม่สำเร็จ (${response.status})`);
        return response.json() as Promise<OptionsResponse>;
      })
      .then(setOptions)
      .catch(() => { /* ใช้ตัวเลือกจาก Matrix เป็น fallback ได้ จึงไม่ขัดการสร้างกราฟ */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const delay = firstRequest.current ? 0 : 300;
    firstRequest.current = false;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      fetch(matrixUrl(filters), { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) {
            const body = await response.text();
            let message = `โหลดข้อมูลไม่สำเร็จ (${response.status})`;
            try { message = (JSON.parse(body) as { error?: string }).error ?? message; } catch { /* คงข้อความสถานะเมื่อเซิร์ฟเวอร์ไม่ได้ส่ง JSON */ }
            throw new Error(message);
          }
          return response.json() as Promise<ChartMatrixResponse>;
        })
        .then((result) => { setCells(result.rows); setMeta(result.meta); })
        .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, delay);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [filterKey, filters]);

  const updateQueryFilters = useCallback((next: QueryFilters) => {
    setFilters((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, []);

  return <div className="chart-advanced-section">
    {customerBehavior && <p className="chart-advanced-note">ส่วนนี้ใช้ข้อมูลการเงินระดับงวด × Agent ที่ยืนยันแล้ว แยกจากตัวกรองพฤติกรรมลูกค้าด้านบน</p>}
    {error && <div className="chart-advanced-error" role="alert">{error} <button type="button" onClick={() => setFilters((current) => ({ ...current }))}>ลองอีกครั้ง</button></div>}
    {!cells && loading && <p className="chart-advanced-note" role="status">กำลังโหลด 24 งวดล่าสุดสำหรับเปรียบเทียบ…</p>}
    {cells && <CustomChartBuilder cells={cells} initialXMetric={initialXMetric} initialYMetric={initialYMetric} onCancel={onCancel} drawOptions={options.draws} agentOptions={options.agents} dataLoading={loading} matrixMeta={meta} onQueryFiltersChange={updateQueryFilters} />}
  </div>;
}

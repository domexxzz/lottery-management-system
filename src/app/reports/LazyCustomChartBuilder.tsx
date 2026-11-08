"use client";

import { useEffect, useState } from "react";
import { CustomChartBuilder, type ChartMatrixCell } from "./CustomChartBuilder";
import type { ReportMetric } from "./ReportChart";

export function LazyCustomChartBuilder({ customerBehavior = false, initialXMetric, initialYMetric, onCancel }: { customerBehavior?: boolean; initialXMetric?: ReportMetric; initialYMetric?: ReportMetric; onCancel?: () => void }) {
  const [cells, setCells] = useState<ChartMatrixCell[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cells || error) return;
    const controller = new AbortController();
    fetch("/api/reports/chart-matrix", { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.text();
          let message = `โหลดข้อมูลไม่สำเร็จ (${response.status})`;
          try { message = (JSON.parse(body) as { error?: string }).error ?? message; } catch { /* คงข้อความสถานะเมื่อเซิร์ฟเวอร์ไม่ได้ส่ง JSON */ }
          throw new Error(message);
        }
        return response.json() as Promise<ChartMatrixCell[]>;
      })
      .then(setCells)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ"); });
    return () => controller.abort();
  }, [cells, error]);

  return <div className="chart-advanced-section">
    {customerBehavior && <p className="chart-advanced-note">ส่วนนี้ใช้ข้อมูลการเงินระดับงวด × Agent ที่ยืนยันแล้วทั้งหมด แยกจากตัวกรองพฤติกรรมลูกค้าด้านบน</p>}
    {error && <div className="chart-advanced-error" role="alert">{error} <button type="button" onClick={() => setError("")}>ลองอีกครั้ง</button></div>}
    {!cells && !error && <p className="chart-advanced-note" role="status">กำลังโหลดข้อมูลสำหรับเปรียบเทียบ…</p>}
    {cells && <CustomChartBuilder cells={cells} initialXMetric={initialXMetric} initialYMetric={initialYMetric} onCancel={onCancel} />}
  </div>;
}

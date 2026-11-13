import { z } from "zod";
import type { ChartMatrixFilters } from "./service";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const querySchema = z.object({
  from: z.string().regex(datePattern).optional(),
  to: z.string().regex(datePattern).optional(),
  drawLimit: z.coerce.number().int().min(1).max(60).default(24),
  rowLimit: z.coerce.number().int().min(1).max(10_000).default(5_000),
  drawIds: z.array(z.string().min(1)).max(60).default([]),
  agentIds: z.array(z.string().min(1)).max(250).default([]),
});

export type ChartMatrixQueryResult =
  | { success: true; filters: ChartMatrixFilters }
  | { success: false; error: string };

function values(params: URLSearchParams, name: string) {
  return [...new Set(params.getAll(name).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean))];
}
/** แปลงตัวกรองวันที่ตามเขตเวลาไทยก่อนส่งลงฐานข้อมูล */
export function parseChartMatrixQuery(params: URLSearchParams): ChartMatrixQueryResult {
  const parsed = querySchema.safeParse({
    from: params.get("from") || undefined,
    to: params.get("to") || undefined,
    drawLimit: params.get("drawLimit") || undefined,
    rowLimit: params.get("rowLimit") || undefined,
    drawIds: values(params, "drawIds"),
    agentIds: values(params, "agentIds"),
  });
  if (!parsed.success) return { success: false, error: "ตัวกรองกราฟไม่ถูกต้อง" };
  if (parsed.data.from && parsed.data.to && parsed.data.from > parsed.data.to) {
    return { success: false, error: "วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มต้น" };
  }
  return {
    success: true,
    filters: {
      drawIds: parsed.data.drawIds,
      agentIds: parsed.data.agentIds,
      drawLimit: parsed.data.drawLimit,
      rowLimit: parsed.data.rowLimit,
      from: parsed.data.from ? new Date(`${parsed.data.from}T00:00:00.000+07:00`) : undefined,
      to: parsed.data.to ? new Date(`${parsed.data.to}T23:59:59.999+07:00`) : undefined,
    },
  };
}


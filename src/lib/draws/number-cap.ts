import { Prisma } from "@prisma/client";
import {
  exposureByStatus,
  exposureMap,
  exposureSummary,
  type ExposureRow,
  type ExposureSummary,
} from "./number-exposure";

/**
 * เพดานรับต่อเลข ("เลขเต็ม" อัตโนมัติ)
 *
 * ยอดแทงของเลขเดียวกันในประเภทรางวัลเดียวกัน รวมทุก Agent ทั้งงวด ต้องไม่เกินเพดานของงวด
 * ยอดครบเพดานแล้วเลขนั้นคือ "เลขเต็ม" ระบบปิดรับเองโดยไม่ต้องมีคนตั้ง
 *
 * ยอดทั้งหมดมาจาก SQL aggregation ใน number-exposure.ts ที่เดียว
 */

/** ค่าเริ่มต้นของงวดใหม่ ตรงกับ @default ในคอลัมน์ draws.numberCap */
export const DEFAULT_NUMBER_CAP = 2000;

/** แสดงในประกาศได้ไม่เกินนี้ ที่เหลือดูต่อในหน้ารายการเลขเต็ม */
export const ANNOUNCEMENT_NEAR_LIMIT = 10;
export const ANNOUNCEMENT_FULL_LIMIT = 300;

type SqlClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * กันสองบิลยืนยันพร้อมกันแล้วรวมกันเกินเพดาน
 *
 * ล็อกระดับงวดจนจบ transaction บิลของงวดเดียวกันจึงตรวจยอดทีละใบ
 * ใช้ advisory lock แทนการล็อกแถวงวด เพื่อไม่ให้ไปขวางงานอื่นที่แก้แถวงวด
 */
export async function lockDrawNumberCap(tx: SqlClient, drawId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM (SELECT pg_advisory_xact_lock(hashtext(${`number-cap:${drawId}`}))) AS cap_lock`;
}

/** ยอดที่บิลใบอื่นแทงไปแล้ว เฉพาะประเภทรางวัลที่บิลนี้ใช้ คีย์ตาม dedupeKey */
export function loadNumberUsage(
  client: SqlClient,
  drawId: string,
  options: { excludeBillId?: string; prizeTypeIds?: readonly string[] } = {},
): Promise<Map<string, Prisma.Decimal>> {
  return exposureMap(client, { drawId, cap: null, ...options });
}

/** เพดานแบบตัวเลขสำหรับแสดงผล เช่น "2,000" */
export function capLabel(cap: Prisma.Decimal | null): string {
  return cap === null ? "ไม่จำกัด" : Number(cap).toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

type DrawCapInput = readonly { id: string; numberCap: Prisma.Decimal | null }[];

/** เลขเต็มทุกตัวของหลายงวด สำหรับหน้าแทงบิลที่ต้องเตือนทุกเลข */
export async function fullNumbersByDraw(
  client: SqlClient,
  organizationId: string,
  draws: DrawCapInput,
): Promise<Map<string, ExposureRow[]>> {
  const capped = draws.filter((draw) => draw.numberCap !== null);
  const entries = await Promise.all(capped.map(async (draw) => [
    draw.id,
    await exposureByStatus(client, { drawId: draw.id, cap: draw.numberCap, organizationId }, "full"),
  ] as const));
  return new Map(entries);
}

export type CapStatus = { summary: ExposureSummary; full: ExposureRow[]; near: ExposureRow[] };

/** สรุป + เลขเต็ม + เลขใกล้เต็มที่สุด ของหลายงวด สำหรับประกาศและแดชบอร์ด */
export async function capStatusByDraw(
  client: SqlClient,
  organizationId: string,
  draws: DrawCapInput,
  limits: { near?: number; full?: number } = {},
): Promise<Map<string, CapStatus>> {
  const capped = draws.filter((draw) => draw.numberCap !== null);
  const entries = await Promise.all(capped.map(async (draw) => {
    const scope = { drawId: draw.id, cap: draw.numberCap, organizationId };
    const [summary, full, near] = await Promise.all([
      exposureSummary(client, scope),
      exposureByStatus(client, scope, "full", limits.full ?? ANNOUNCEMENT_FULL_LIMIT),
      exposureByStatus(client, scope, "near", limits.near ?? ANNOUNCEMENT_NEAR_LIMIT),
    ]);
    return [draw.id, { summary, full, near }] as const;
  }));
  return new Map(entries);
}

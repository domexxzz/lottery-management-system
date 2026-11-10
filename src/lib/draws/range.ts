import { Prisma } from "@prisma/client";

/**
 * กรองตามช่วงวันที่ของงวด (วันออกรางวัล) ไม่ใช่วันที่สร้างบิล
 *
 * ลูกค้าจ่ายเงินให้ตัวแทนเป็นรายเดือน เดือนหนึ่งมีสองงวด (1 กับ 16)
 * เลือก 1–31 ธ.ค. จึงต้องได้ทั้งสองงวดของเดือนนั้นครบ แม้บิลบางใบจะถูกสร้างตั้งแต่ปลายเดือนก่อน
 */

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const THAI_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"] as const;
const THAI_SHORT_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."] as const;

/** งวดเดียว / หลายงวด / ไม่กรอง */
export type DrawFilter = string | readonly string[] | undefined;

/** วันที่ YYYY-MM-DD ที่ถูกต้อง หรือ undefined */
export function parseDay(value: string | null | undefined): string | undefined {
  if (!value || !DAY.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? undefined : value;
}

/** วันออกรางวัลของงวด ใช้ drawDate ถ้ามี ไม่งั้นใช้วันปิดรับตามเวลาไทย */
export function drawDay(draw: { drawDate: Date | null; cutoffAt: Date }): string {
  if (draw.drawDate) return draw.drawDate.toISOString().slice(0, 10);
  return new Date(draw.cutoffAt.getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

export function inRange(day: string, from: string | undefined, to: string | undefined): boolean {
  return (!from || day >= from) && (!to || day <= to);
}

/** เงื่อนไข SQL สำหรับคอลัมน์ drawId ตาม DrawFilter */
export function drawFilterSql(column: Prisma.Sql, filter: DrawFilter): Prisma.Sql {
  if (filter === undefined) return Prisma.empty;
  if (typeof filter === "string") return Prisma.sql`AND ${column} = ${filter}`;
  if (filter.length === 0) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${column} IN (${Prisma.join(filter)})`;
}

/** label แบบสั้น "ธ.ค. 69" · name แบบเต็ม "ธันวาคม 2569" */
export type MonthShortcut = { key: string; label: string; name: string; from: string; to: string };

/** ปุ่มลัดรายเดือน จากเดือนที่มีงวดจริง ใหม่สุดก่อน */
export function monthShortcuts(days: string[], limit = 12): MonthShortcut[] {
  const months = [...new Set(days.map((day) => day.slice(0, 7)))].sort().reverse().slice(0, limit);
  return months.map((key) => {
    const [year, month] = key.split("-").map(Number) as [number, number];
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      key,
      label: `${THAI_SHORT_MONTHS[month - 1]} ${String(year + 543).slice(-2)}`,
      name: `${THAI_MONTHS[month - 1]} ${year + 543}`,
      from: `${key}-01`,
      to: `${key}-${String(lastDay).padStart(2, "0")}`,
    };
  });
}

/** เดือนล่าสุดตามเวลาไทย นับจากเดือนปัจจุบันย้อนหลัง ใช้ทำ dropdown "เลือกทั้งเดือน" */
export function recentMonths(now: Date, count = 12): MonthShortcut[] {
  const bangkok = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const year = bangkok.getUTCFullYear();
  const month = bangkok.getUTCMonth();
  const days = Array.from({ length: count }, (_, index) => new Date(Date.UTC(year, month - index, 1)).toISOString().slice(0, 10));
  return monthShortcuts(days, count);
}

/** "1 ธ.ค. 69" */
export function thaiDayLabel(day: string): string {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return `${date} ${THAI_SHORT_MONTHS[month - 1]} ${String(year + 543).slice(-2)}`;
}

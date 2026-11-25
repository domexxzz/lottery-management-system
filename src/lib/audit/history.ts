import { parseDay } from "@/lib/draws/range";

export type AuditDateRange = {
  fromDay?: string;
  toDay?: string;
  from?: Date;
  to?: Date;
};

/** ช่วงเวลาประวัติตามวันประเทศไทย ใช้ร่วมกันระหว่างหน้าจอและไฟล์ส่งออก */
export function auditDateRange(dateFrom: string | null | undefined, dateTo: string | null | undefined): AuditDateRange {
  const fromDay = parseDay(dateFrom);
  const toDay = parseDay(dateTo);
  return {
    fromDay,
    toDay,
    from: fromDay ? new Date(`${fromDay}T00:00:00+07:00`) : undefined,
    to: toDay ? new Date(`${toDay}T23:59:59.999+07:00`) : undefined,
  };
}

/** undefined = ทุกงวด, [] = ไม่มีงวดที่ตรงประเภท */
export function auditDrawWhere(drawIds: string[] | undefined): { drawId?: { in: string[] } } {
  return drawIds === undefined ? {} : { drawId: { in: drawIds } };
}

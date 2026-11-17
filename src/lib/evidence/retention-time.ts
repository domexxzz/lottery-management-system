/** อายุการเก็บรูปหลักฐาน (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล) */

export const EVIDENCE_RETENTION_YEARS = 1;

/** วันที่รูปจะถูกลบอัตโนมัติ: ครบ 1 ปีตามปฏิทินนับจากเวลาที่แนบ */
export function evidenceExpiresAt(createdAt: Date): Date {
  const expires = new Date(createdAt);
  expires.setUTCFullYear(expires.getUTCFullYear() + EVIDENCE_RETENTION_YEARS);
  return expires;
}

/** รูปที่แนบก่อนเวลานี้ถือว่าหมดอายุแล้ว */
export function evidenceCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - EVIDENCE_RETENTION_YEARS);
  return cutoff;
}

/** จำนวนวันที่เหลือก่อนถูกลบ ปัดขึ้น (เหลือ 3 ชั่วโมงยังนับเป็น 1 วัน) และไม่ติดลบ */
export function daysUntilExpiry(createdAt: Date, now: Date): number {
  const ms = evidenceExpiresAt(createdAt).getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** ข้อความระยะเวลาที่เหลือแบบคนอ่าน เช่น "อีก 11 เดือน 3 วัน" */
export function remainingLabel(days: number): string {
  if (days <= 0) return "ครบกำหนดแล้ว รอระบบลบ";
  if (days < 30) return `อีก ${days} วัน`;
  const months = Math.floor(days / 30);
  const rest = days - months * 30;
  return rest === 0 ? `อีก ${months} เดือน` : `อีก ${months} เดือน ${rest} วัน`;
}

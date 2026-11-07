/**
 * ทำความสะอาดข้อความที่ผู้ใช้ตั้งเอง ก่อนนำไปวางใน prompt
 *
 * ชื่อองค์กรและชื่อรอบเป็น free text ที่ Owner หรือ Admin พิมพ์เอง
 * ถ้าใส่ลง prompt ดิบ ๆ ชื่อรอบที่เขียนเป็นคำสั่งจะกลายเป็นคำสั่งของโมเดล
 *
 * นี่ไม่ใช่การป้องกันที่สมบูรณ์ — ด่านจริงคือผู้ช่วยไม่มี tool ไม่มีสิทธิ์เขียน
 * ฟังก์ชันนี้แค่ตัดรูปแบบที่ใช้แยกส่วนของ prompt ออกไป ไม่ให้ปลอมเป็นโครงสร้าง
 */

/** ความยาวสูงสุดของชื่อที่ยอมให้เข้า prompt — ชื่อจริงในระบบสั้นกว่านี้มาก */
const MAX_LABEL_LENGTH = 80;

export const EMPTY_LABEL = "(ไม่ระบุ)";

export function sanitizeLabel(raw: string | null | undefined): string {
  if (typeof raw !== "string") return EMPTY_LABEL;

  const cleaned = raw
    // อักขระควบคุมและตัวขึ้นบรรทัดใหม่ ใช้ปลอมเป็นข้อความคนละท่อนได้
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    // เครื่องหมายที่ระบบใช้คั่นบล็อกของ prompt
    .replace(/[`<>{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned === "") return EMPTY_LABEL;
  return cleaned.length > MAX_LABEL_LENGTH
    ? `${cleaned.slice(0, MAX_LABEL_LENGTH)}…`
    : cleaned;
}

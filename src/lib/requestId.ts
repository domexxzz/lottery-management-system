/**
 * ชื่อ header ที่ใช้ส่งต่อ request_id
 *
 * แยกเป็นโมดูลของตัวเองเพราะทั้ง middleware (edge runtime) และโค้ดฝั่ง server
 * (node runtime) ต้องใช้ค่านี้ ถ้า import ข้ามกันตรง ๆ จะลาก runtime มาปนกัน
 */
export const REQUEST_ID_HEADER = "x-request-id";

const MAX_LENGTH = 128;

/**
 * ค่าที่รับมาจากภายนอกต้องถูกจำกัดความยาวและชุดอักขระ
 * ไม่งั้นจะกลายเป็นช่องทางยัดข้อมูลลง log และฐานข้อมูล
 */
export function isUsableRequestId(value: string | null | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_LENGTH &&
    /^[\w.:-]+$/.test(value)
  );
}

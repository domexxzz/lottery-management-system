import { MIN_STAKE_PER_ITEM } from "./betting";

/**
 * ตรวจระดับช่องกรอก ใช้ได้ทั้งฝั่ง client และ server
 *
 * โมดูลนี้ไม่พึ่ง Prisma.Decimal จึงส่งลงเบราว์เซอร์ได้โดยไม่ลาก runtime
 * ของฐานข้อมูลตามไปด้วย
 *
 * ขอบเขต: ตรวจเฉพาะสิ่งที่ตัดสินได้จากช่องเดียว
 * กฎที่ต้องดูทั้งใบ (เลขซ้ำ วงเงินต่อเลข วงเงินรวม cutoff) อยู่ใน validation.ts
 * และตัดสินที่ server เท่านั้น การตรวจฝั่ง client เป็นเพียงความสะดวก
 */

export function checkNumberField(value: string, digits: number): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null; // แถวว่างไม่ถือเป็นรายการ

  if (!/^\d+$/.test(trimmed)) return "ต้องเป็นตัวเลขเท่านั้น";
  if (trimmed.length !== digits) return `ต้องกรอก ${digits} หลัก`;
  return null;
}

export function checkStakeField(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return "ต้องเป็นตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง";
  if (Number(trimmed) <= 0) return "ต้องมากกว่า 0";
  if (Number(trimmed) < MIN_STAKE_PER_ITEM) return `ขั้นต่ำ ${MIN_STAKE_PER_ITEM} บาท`;
  return null;
}

/** แถวถือว่ากรอกไม่ครบเมื่อกรอกมาอย่างใดอย่างหนึ่ง */
export function checkRowComplete(numberValue: string, stakeValue: string): string | null {
  const hasNumber = numberValue.trim() !== "";
  const hasStake = stakeValue.trim() !== "";

  if (hasNumber && !hasStake) return "กรอกยอดเดิมพันด้วย";
  if (!hasNumber && hasStake) return "กรอกเลขด้วย";
  return null;
}

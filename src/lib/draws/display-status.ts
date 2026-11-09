export type DrawDisplayStatus = "OPEN" | "CLOSED" | "CHECKED";

export const DRAW_DISPLAY_STATUS_LABEL: Record<DrawDisplayStatus, string> = {
  OPEN: "เปิดรับ",
  CLOSED: "ปิดรับ",
  CHECKED: "ตรวจผลแล้ว",
};

/**
 * สถานะในฐานข้อมูลมีหลายขั้นเพื่อควบคุม workflow แต่ผู้ใช้ต้องตัดสินใจจาก 3 ขั้นนี้เท่านั้น
 * ไม่แก้สถานะจริงและไม่ลดทอนกฎทางธุรกิจของงวด
 */
export function getDrawDisplayStatus(draw: { status: string }): DrawDisplayStatus {
  if (draw.status === "SETTLED" || draw.status === "CLOSED") return "CHECKED";
  if (draw.status === "OPEN") return "OPEN";
  return "CLOSED";
}

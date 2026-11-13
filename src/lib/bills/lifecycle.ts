import type { BillStatus } from "@prisma/client";

/**
 * Bill State Lifecycle ตามเอกสารบทที่ 4
 *
 *   DRAFT ──confirm──▶ CONFIRMED ──cutoff──▶ LOCKED ──settle──▶ SETTLED
 *     │                    │
 *     └──── delete ────────┘
 *
 * CANCELLED และ SETTLED เป็นสถานะปลายทาง ออกไปไหนไม่ได้อีก
 */
const ALLOWED: Record<BillStatus, readonly BillStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["LOCKED", "CANCELLED"],
  LOCKED: ["SETTLED"],
  SETTLED: [],
  CANCELLED: [],
};

const LABEL: Record<BillStatus, string> = {
  DRAFT: "ร่าง",
  CONFIRMED: "ยืนยันแล้ว",
  LOCKED: "ปิดรับแล้ว",
  SETTLED: "คำนวณแล้ว",
  CANCELLED: "ลบแล้ว",
};

export function canTransition(from: BillStatus, to: BillStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function statusLabel(status: BillStatus): string {
  return LABEL[status];
}

export function transitionError(from: BillStatus, to: BillStatus): string {
  return `เปลี่ยนสถานะบิลจาก "${LABEL[from]}" เป็น "${LABEL[to]}" ไม่ได้`;
}

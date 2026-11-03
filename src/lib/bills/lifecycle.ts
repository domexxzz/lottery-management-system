import type { BillStatus } from "@prisma/client";

/**
 * Bill State Lifecycle ตามเอกสารบทที่ 4
 *
 *   DRAFT ──confirm──▶ CONFIRMED ──cutoff──▶ LOCKED ──settle──▶ SETTLED
 *     │                    │                   │
 *     └──────────────── cancel ────────────────┘
 *
 * CANCELLED และ SETTLED เป็นสถานะปลายทาง ออกไปไหนไม่ได้อีก
 */
const ALLOWED: Record<BillStatus, readonly BillStatus[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["LOCKED", "CANCELLED"],
  LOCKED: ["SETTLED", "CANCELLED"],
  SETTLED: [],
  CANCELLED: [],
};

const LABEL: Record<BillStatus, string> = {
  DRAFT: "ร่าง",
  CONFIRMED: "ยืนยันแล้ว",
  LOCKED: "ปิดรับแล้ว",
  SETTLED: "คำนวณแล้ว",
  CANCELLED: "ยกเลิก",
};

export function canTransition(from: BillStatus, to: BillStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function statusLabel(status: BillStatus): string {
  return LABEL[status];
}

/** ยกเลิกหลัง Cutoff ต้องมีผู้อนุมัติ ไม่ใช่แค่สิทธิ์ยกเลิกธรรมดา (เอกสารบทที่ 4) */
export function cancelNeedsApproval(status: BillStatus): boolean {
  return status === "LOCKED";
}

export function transitionError(from: BillStatus, to: BillStatus): string {
  return `เปลี่ยนสถานะบิลจาก "${LABEL[from]}" เป็น "${LABEL[to]}" ไม่ได้`;
}

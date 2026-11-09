import type { AttachmentStatus, BillStatus, Role } from "@prisma/client";

export function canManageDraftEvidence(input: { role: Role; billStatus: BillStatus }): boolean {
  return input.billStatus === "DRAFT";
}

/**
 * เพิ่มหลักฐานใหม่ได้ทั้งบิลร่างและบิลที่ยืนยันแล้วแต่ยังไม่ปิดรับ
 * เพราะหน้าแทงเลขยืนยันบิลทันที แล้วให้แนบหลักฐานตามมาภายหลัง
 */
export function canAddEvidence(input: { role: Role; billStatus: BillStatus }): boolean {
  return input.billStatus === "DRAFT" || input.billStatus === "CONFIRMED";
}

export function canReplaceRejectedEvidence(input: {
  role: Role;
  billStatus: BillStatus;
  attachmentStatus: AttachmentStatus;
}): boolean {
  return (
    input.attachmentStatus === "REJECTED" &&
    input.billStatus !== "SETTLED" &&
    input.billStatus !== "CANCELLED"
  );
}

export function canReviewEvidence(role: Role): boolean {
  return role === "GODMODE" || role === "OWNER" || role === "ADMIN";
}

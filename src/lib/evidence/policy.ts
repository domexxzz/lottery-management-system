import type { AttachmentStatus, BillStatus, Role } from "@prisma/client";

export function canManageDraftEvidence(input: { role: Role; billStatus: BillStatus }): boolean {
  return input.billStatus === "DRAFT";
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
  return role === "OWNER" || role === "ADMIN";
}

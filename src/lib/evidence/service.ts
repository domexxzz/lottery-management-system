import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { Prisma, type AttachmentStatus, type AttachmentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit, type TxClient } from "@/lib/audit";
import { billScope, requirePermission, type Actor } from "@/lib/auth/context";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { getStorageConfig } from "@/lib/storage/config";
import { getStorageProvider } from "@/lib/storage/provider";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import { validateAndProcessEvidenceImage } from "./image";
import { canManageDraftEvidence, canReplaceRejectedEvidence, canReviewEvidence } from "./policy";

export type PaymentInput = {
  amount: string;
  paidAt?: string;
  paymentMethod?: string;
  bankName?: string;
  transactionReference?: string;
  note?: string;
};

export type UploadEvidenceInput = {
  type: AttachmentType;
  fileName: string;
  declaredMimeType: string;
  bytes: Buffer;
  idempotencyKey: string;
  replacesId?: string;
  payment?: PaymentInput;
};

function cleanOptional(value: string | undefined, max: number): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  if (clean.length > max) throw new ValidationError(`ข้อมูลต้องไม่เกิน ${max} ตัวอักษร`);
  return clean;
}

function paymentData(input: PaymentInput) {
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(input.amount);
  } catch {
    throw new ValidationError("จำนวนเงินที่ชำระไม่ถูกต้อง");
  }
  if (amount.lte(0)) throw new ValidationError("จำนวนเงินที่ชำระต้องมากกว่า 0");
  const paidAt = input.paidAt?.trim() ? new Date(input.paidAt) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new ValidationError("วันและเวลาชำระไม่ถูกต้อง");
  if (paidAt.getTime() > Date.now() + 5 * 60_000) throw new ValidationError("วันและเวลาชำระต้องไม่อยู่ในอนาคต");
  const paymentMethod = input.paymentMethod?.trim() || "ไม่ระบุ";
  if (paymentMethod.length > 80) throw new ValidationError("ช่องทางการชำระเงินต้องไม่เกิน 80 ตัวอักษร");
  return {
    amount,
    paidAt,
    paymentMethod,
    bankName: cleanOptional(input.bankName, 120),
    transactionReference: cleanOptional(input.transactionReference, 120),
    note: cleanOptional(input.note, 500),
  };
}

function safeOriginalName(fileName: string): string {
  const clean = basename(fileName.replaceAll("\\", "/")).replace(/[\r\n]/g, "_").slice(0, 180);
  return clean || "evidence-image";
}

function attachmentDto(row: {
  id: string;
  type: AttachmentType;
  originalName: string;
  mimeType: string;
  fileSize: number;
  status: AttachmentStatus;
  rejectionReason: string | null;
  verifiedAt: Date | null;
  createdAt: Date;
  replacesId: string | null;
  uploadedBy?: { displayName: string } | null;
  verifiedBy?: { displayName: string } | null;
}) {
  return {
    id: row.id,
    type: row.type,
    originalName: row.originalName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    status: row.status,
    rejectionReason: row.rejectionReason,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    replacesId: row.replacesId,
    uploadedBy: row.uploadedBy?.displayName ?? null,
    verifiedBy: row.verifiedBy?.displayName ?? null,
  };
}

async function visibleBill(actor: Actor, billId: string) {
  const bill = await prisma.bill.findFirst({
    where: { id: billId, ...billScope(actor) },
    select: { id: true, organizationId: true, agentId: true, drawId: true, status: true },
  });
  if (!bill) throw new NotFoundError("ไม่พบบิล");
  return bill;
}

export async function uploadBillAttachment(
  actor: Actor,
  billId: string,
  input: UploadEvidenceInput,
  storage: PrivateObjectStorage = getStorageProvider(),
) {
  requirePermission(actor, "evidence.upload");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)) {
    throw new ValidationError("Upload token ไม่ถูกต้อง");
  }

  const idempotent = await prisma.billAttachment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { uploadedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } },
  });
  if (idempotent) {
    if (idempotent.organizationId !== actor.organizationId || idempotent.billId !== billId) throw new ConflictError("Upload token ถูกใช้งานแล้ว");
    return attachmentDto(idempotent);
  }

  const bill = await visibleBill(actor, billId);
  const replacement = input.replacesId
    ? await prisma.billAttachment.findFirst({
        where: { id: input.replacesId, billId: bill.id, organizationId: bill.organizationId, replacedBy: null },
        select: { id: true, type: true, status: true },
      })
    : null;

  if (input.replacesId && !replacement) throw new NotFoundError("ไม่พบหลักฐานเดิมที่ต้องการเปลี่ยน");
  if (replacement) {
    if (replacement.type !== input.type) throw new ValidationError("ไฟล์ใหม่ต้องเป็นหลักฐานประเภทเดิม");
    if (!canReplaceRejectedEvidence({ role: actor.role, billStatus: bill.status, attachmentStatus: replacement.status })) {
      throw new ConflictError("เปลี่ยนได้เฉพาะหลักฐานที่ถูกตีกลับและบิลยังไม่ปิดบัญชี");
    }
  } else if (!canManageDraftEvidence({ role: actor.role, billStatus: bill.status })) {
    throw new ConflictError("เพิ่มหลักฐานใหม่ได้เฉพาะบิลร่าง");
  }

  const config = getStorageConfig();
  const activeCount = await prisma.billAttachment.count({ where: { billId: bill.id, replacedBy: null } });
  if (!replacement && activeCount >= config.maxFilesPerBill) {
    throw new ValidationError(`แนบรูปได้รวมไม่เกิน ${config.maxFilesPerBill} รูปต่อบิล`);
  }

  /*
   * รับเฉพาะหลักฐานการสั่งซื้อ
   *
   * ด่านนี้อยู่ฝั่งเซิร์ฟเวอร์ เพราะเอาปุ่มออกจากหน้าจออย่างเดียวไม่ได้ปิดทาง
   * ใครยิง API ตรงก็ยังแนบสลิปได้อยู่ดี
   *
   * แถวเก่าที่เป็น PAYMENT_EVIDENCE ยังอยู่ในฐานข้อมูลและยังเปิดดูย้อนหลังได้
   * ไม่ลบทิ้ง เพราะเป็นหลักฐานของบิลที่ปิดไปแล้ว
   */
  if (input.type === "PAYMENT_EVIDENCE") {
    throw new ValidationError("ระบบรับเฉพาะหลักฐานการสั่งซื้อ ไม่รับสลิปการชำระเงินแล้ว");
  }
  const parsedPayment = input.payment ? paymentData(input.payment) : null;
  if (parsedPayment?.transactionReference) {
    const reusedReference = await prisma.billPayment.findFirst({
      where: {
        organizationId: bill.organizationId,
        transactionReference: parsedPayment.transactionReference,
        billId: { not: bill.id },
      },
      select: { id: true },
    });
    if (reusedReference) throw new ConflictError("หมายเลขอ้างอิงการชำระเงินนี้เคยถูกใช้แล้ว กรุณาตรวจสอบ");
  }
  const processed = await validateAndProcessEvidenceImage({
    bytes: input.bytes,
    fileName: input.fileName,
    declaredMimeType: input.declaredMimeType,
  });

  const storageKey = `organizations/${bill.organizationId}/draws/${bill.drawId}/bills/${bill.id}/${randomUUID()}.webp`;
  await storage.upload({
    key: storageKey,
    body: processed.body,
    contentType: processed.mimeType,
    metadata: { checksum: processed.originalChecksum, uploader: actor.userId },
  });

  try {
    const stored = await storage.getObjectMetadata(storageKey);
    if (stored.size !== processed.body.length) throw new Error("ขนาด Object หลัง Upload ไม่ตรงกับไฟล์ที่ประมวลผล");

    const created = await prisma.$transaction(async (tx) => {
      let paymentId: string | null = null;
      if (input.type === "PAYMENT_EVIDENCE" && parsedPayment) {
        const payment = await tx.billPayment.upsert({
          where: { billId: bill.id },
          create: {
            organizationId: bill.organizationId,
            billId: bill.id,
            ...parsedPayment,
          },
          update: {
            ...parsedPayment,
            verificationStatus: "PENDING",
            verifiedById: null,
            verifiedAt: null,
            rejectionReason: null,
          },
          select: { id: true },
        });
        paymentId = payment.id;
      }

      const row = await tx.billAttachment.create({
        data: {
          organizationId: bill.organizationId,
          billId: bill.id,
          paymentId,
          type: input.type,
          storageKey,
          originalName: safeOriginalName(input.fileName),
          mimeType: processed.mimeType,
          fileSize: processed.body.length,
          checksum: processed.originalChecksum,
          idempotencyKey: input.idempotencyKey,
          uploadedById: actor.userId,
          replacesId: replacement?.id ?? null,
        },
        include: { uploadedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } },
      });

      await writeAudit(tx, {
        organizationId: bill.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: replacement ? "FILE_REPLACED" : "FILE_UPLOADED",
        entityType: "BillAttachment",
        entityId: row.id,
        before: replacement ? { attachmentId: replacement.id, status: replacement.status } : undefined,
        after: { billId: bill.id, type: row.type, status: row.status, checksum: row.checksum },
      });
      return row;
    });
    return attachmentDto(created);
  } catch (error) {
    try {
      await storage.delete(storageKey);
    } catch (cleanupError) {
      console.error("Failed to clean orphaned evidence object", { storageKey, cleanupError });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ConflictError("คำขออัปโหลดหรือข้อมูลการชำระเงินนี้ถูกบันทึกแล้ว");
    }
    throw error;
  }
}

export async function listBillAttachments(actor: Actor, billId: string) {
  requirePermission(actor, "evidence.view");
  await visibleBill(actor, billId);
  const rows = await prisma.billAttachment.findMany({
    where: { billId, organizationId: actor.organizationId },
    orderBy: { createdAt: "asc" },
    include: { uploadedBy: { select: { displayName: true } }, verifiedBy: { select: { displayName: true } } },
  });
  return rows.map(attachmentDto);
}

async function attachmentForActor(actor: Actor, attachmentId: string) {
  requirePermission(actor, "evidence.view");
  const attachment = await prisma.billAttachment.findFirst({
    where: { id: attachmentId, organizationId: actor.organizationId },
    include: { bill: { select: { id: true, agentId: true, status: true } } },
  });
  if (!attachment || (actor.role === "AGENT" && attachment.bill.agentId !== actor.agentId)) {
    throw new NotFoundError("ไม่พบหลักฐาน");
  }
  return attachment;
}

export async function signedAttachmentUrl(
  actor: Actor,
  attachmentId: string,
  disposition: "inline" | "attachment",
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<string> {
  const attachment = await attachmentForActor(actor, attachmentId);
  if (!(await storage.objectExists(attachment.storageKey))) throw new NotFoundError("ไม่พบไฟล์หลักฐานใน Storage");
  return storage.getSignedUrl({ key: attachment.storageKey, fileName: attachment.originalName, disposition });
}

export async function deleteDraftAttachment(
  actor: Actor,
  attachmentId: string,
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<void> {
  requirePermission(actor, "evidence.upload");
  const attachment = await attachmentForActor(actor, attachmentId);
  if (!canManageDraftEvidence({ role: actor.role, billStatus: attachment.bill.status })) {
    throw new ConflictError("ลบหลักฐานได้เฉพาะตอนบิลยังเป็นร่าง");
  }
  const replaced = await prisma.billAttachment.findFirst({ where: { replacesId: attachment.id }, select: { id: true } });
  if (replaced) throw new ConflictError("ลบหลักฐานเวอร์ชันเก่าที่มีไฟล์แทนแล้วไม่ได้");

  await prisma.$transaction(async (tx) => {
    await tx.billAttachment.delete({ where: { id: attachment.id } });
    await writeAudit(tx, {
      organizationId: attachment.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "FILE_DELETED",
      entityType: "BillAttachment",
      entityId: attachment.id,
      before: { billId: attachment.billId, type: attachment.type, checksum: attachment.checksum },
      reason: "ลบหลักฐานจากบิลร่าง",
    });
  });
  try {
    await storage.delete(attachment.storageKey);
  } catch (error) {
    console.error("Evidence metadata deleted but object cleanup failed", { storageKey: attachment.storageKey, error });
  }
}

export async function reviewAttachment(
  actor: Actor,
  attachmentId: string,
  decision: "VERIFIED" | "REJECTED",
  reason?: string,
): Promise<void> {
  requirePermission(actor, "evidence.review");
  if (!canReviewEvidence(actor.role)) throw new ForbiddenError();
  const rejectionReason = decision === "REJECTED" ? reason?.trim() : undefined;
  if (decision === "REJECTED" && !rejectionReason) throw new ValidationError("กรุณาระบุเหตุผลที่ตีกลับ");
  if (rejectionReason && rejectionReason.length > 500) throw new ValidationError("เหตุผลต้องไม่เกิน 500 ตัวอักษร");

  await prisma.$transaction(async (tx) => {
    const attachment = await tx.billAttachment.findFirst({
      where: { id: attachmentId, organizationId: actor.organizationId, replacedBy: null },
      select: { id: true, billId: true, paymentId: true, type: true, status: true },
    });
    if (!attachment) throw new NotFoundError("ไม่พบหลักฐาน");
    if (attachment.status !== "PENDING") throw new ConflictError("หลักฐานนี้ได้รับการตรวจแล้ว");

    await tx.billAttachment.update({
      where: { id: attachment.id },
      data: {
        status: decision,
        verifiedById: actor.userId,
        verifiedAt: new Date(),
        rejectionReason: rejectionReason ?? null,
      },
    });

    await writeAudit(tx, {
      organizationId: actor.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: decision === "VERIFIED" ? "FILE_VERIFIED" : "FILE_REJECTED",
      entityType: "BillAttachment",
      entityId: attachment.id,
      before: { status: attachment.status },
      after: { status: decision },
      reason: rejectionReason,
    });

    if (attachment.paymentId) {
      const activePaymentEvidence = await tx.billAttachment.findMany({
        where: { paymentId: attachment.paymentId, replacedBy: null },
        select: { id: true, status: true },
      });
      const statuses = activePaymentEvidence.map((item) => item.id === attachment.id ? decision : item.status);
      const paymentStatus = statuses.includes("REJECTED")
        ? "REJECTED"
        : statuses.every((status) => status === "VERIFIED")
          ? "VERIFIED"
          : "PENDING";
      await tx.billPayment.update({
        where: { id: attachment.paymentId },
        data: {
          verificationStatus: paymentStatus,
          verifiedById: paymentStatus === "PENDING" ? null : actor.userId,
          verifiedAt: paymentStatus === "PENDING" ? null : new Date(),
          rejectionReason: paymentStatus === "REJECTED" ? rejectionReason : null,
        },
      });
      if (paymentStatus !== "PENDING") {
        await writeAudit(tx, {
          organizationId: actor.organizationId,
          actorId: actor.userId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          action: paymentStatus === "VERIFIED" ? "PAYMENT_VERIFIED" : "PAYMENT_REJECTED",
          entityType: "BillPayment",
          entityId: attachment.paymentId,
          after: { verificationStatus: paymentStatus },
          reason: rejectionReason,
        });
      }
    }
  });
}

/** ตรวจผ่านหลักฐานที่รอตรวจทั้งหมดของบิลใน transaction เดียว */
export async function verifyBillEvidence(actor: Actor, billId: string): Promise<number> {
  requirePermission(actor, "evidence.review");
  if (!canReviewEvidence(actor.role)) throw new ForbiddenError();

  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findFirst({
      where: { id: billId, organizationId: actor.organizationId },
      select: { id: true },
    });
    if (!bill) throw new NotFoundError("ไม่พบบิล");

    const attachments = await tx.billAttachment.findMany({
      where: { billId: bill.id, organizationId: actor.organizationId, replacedBy: null },
      select: { id: true, status: true, paymentId: true },
    });
    if (attachments.length === 0) throw new NotFoundError("ไม่พบหลักฐานของบิลนี้");
    if (attachments.some((item) => item.status === "REJECTED")) {
      throw new ConflictError("ยังมีหลักฐานที่ถูกตีกลับ กรุณาให้ Agent แก้ไขก่อนยืนยันทั้งบิล");
    }
    const pending = attachments.filter((item) => item.status === "PENDING");
    if (pending.length === 0) throw new ConflictError("หลักฐานของบิลนี้ได้รับการตรวจแล้ว");

    const verifiedAt = new Date();
    await tx.billAttachment.updateMany({
      where: { id: { in: pending.map((item) => item.id) } },
      data: { status: "VERIFIED", verifiedById: actor.userId, verifiedAt, rejectionReason: null },
    });
    for (const attachment of pending) {
      await writeAudit(tx, {
        organizationId: actor.organizationId,
        actorId: actor.userId,
        requestId: actor.requestId,
        ipAddress: actor.ipAddress,
        action: "FILE_VERIFIED",
        entityType: "BillAttachment",
        entityId: attachment.id,
        before: { status: attachment.status },
        after: { status: "VERIFIED", verifiedAsBill: true },
        reason: "ยืนยันหลักฐานทั้งบิล",
      });
    }

    const paymentIds = [...new Set(pending.flatMap((item) => item.paymentId ? [item.paymentId] : []))];
    for (const paymentId of paymentIds) {
      const paymentEvidence = await tx.billAttachment.findMany({
        where: { paymentId, replacedBy: null },
        select: { status: true },
      });
      if (paymentEvidence.length > 0 && paymentEvidence.every((item) => item.status === "VERIFIED")) {
        const payment = await tx.billPayment.update({
          where: { id: paymentId },
          data: { verificationStatus: "VERIFIED", verifiedById: actor.userId, verifiedAt, rejectionReason: null },
          select: { id: true },
        });
        await writeAudit(tx, {
          organizationId: actor.organizationId,
          actorId: actor.userId,
          requestId: actor.requestId,
          ipAddress: actor.ipAddress,
          action: "PAYMENT_VERIFIED",
          entityType: "BillPayment",
          entityId: payment.id,
          after: { verificationStatus: "VERIFIED", verifiedAsBill: true },
          reason: "ยืนยันหลักฐานทั้งบิล",
        });
      }
    }
    return pending.length;
  });
}

export async function resubmitEvidence(actor: Actor, billId: string): Promise<void> {
  requirePermission(actor, "evidence.upload");
  const bill = await visibleBill(actor, billId);
  const active = await prisma.billAttachment.findMany({
    where: { billId: bill.id, replacedBy: null },
    select: { id: true, status: true, replacesId: true },
  });
  if (active.some((item) => item.status === "REJECTED")) throw new ConflictError("ยังมีหลักฐานที่ถูกตีกลับและยังไม่ได้เปลี่ยน");
  if (!active.some((item) => item.status === "PENDING" && item.replacesId !== null)) {
    throw new ConflictError("ไม่มีหลักฐานที่แก้ไขเพื่อส่งตรวจใหม่");
  }
  await prisma.$transaction(async (tx) => {
    await writeAudit(tx, {
      organizationId: bill.organizationId,
      actorId: actor.userId,
      requestId: actor.requestId,
      ipAddress: actor.ipAddress,
      action: "BILL_SUBMITTED",
      entityType: "Bill",
      entityId: bill.id,
      after: { evidenceResubmitted: true },
      reason: "ส่งหลักฐานที่แก้ไขแล้วเข้าคิวตรวจใหม่",
    });
  });
}

export async function assertBillEvidenceReady(tx: TxClient, billId: string): Promise<void> {
  const config = getStorageConfig();
  const active = await tx.billAttachment.findMany({
    where: { billId, replacedBy: null },
    select: { type: true, status: true, paymentId: true },
  });
  if (config.requireOrderEvidence && !active.some((item) => item.type === "ORDER_EVIDENCE" && item.status !== "REJECTED")) {
    throw new ValidationError("ต้องแนบหลักฐานการสั่งซื้ออย่างน้อย 1 รูปก่อนยืนยันบิล");
  }
  if (active.some((item) => item.status === "REJECTED")) {
    throw new ValidationError("มีหลักฐานที่ถูกตีกลับ กรุณาเปลี่ยนไฟล์และส่งตรวจใหม่");
  }
  if (active.some((item) => item.type === "PAYMENT_EVIDENCE" && item.paymentId === null)) {
    throw new ValidationError("หลักฐานการชำระเงินยังไม่มีข้อมูลการชำระที่สมบูรณ์");
  }
}

export async function evidenceHistory(actor: Actor, billId: string) {
  await visibleBill(actor, billId);
  const attachments = await prisma.billAttachment.findMany({
    where: { billId, organizationId: actor.organizationId },
    select: { id: true, paymentId: true },
  });
  const ids = attachments.flatMap((item) => [item.id, ...(item.paymentId ? [item.paymentId] : [])]);
  return prisma.auditEvent.findMany({
    where: {
      organizationId: actor.organizationId,
      OR: [
        { entityType: "Bill", entityId: billId, action: "BILL_SUBMITTED" },
        { entityType: { in: ["BillAttachment", "BillPayment"] }, entityId: { in: ids } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      action: true,
      entityType: true,
      entityId: true,
      reason: true,
      createdAt: true,
      actor: { select: { displayName: true, role: true } },
    },
  });
}

export async function listEvidenceReviewQueue(
  actor: Actor,
  filter: { query?: string; status?: AttachmentStatus; statuses?: readonly AttachmentStatus[]; type?: AttachmentType; dateFrom?: Date; dateTo?: Date; page?: number; pageSize?: number },
) {
  requirePermission(actor, "evidence.review");
  if (!canReviewEvidence(actor.role)) throw new ForbiddenError();
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = Math.min(100, Math.max(10, filter.pageSize ?? 25));
  const where: Prisma.BillAttachmentWhereInput = {
    organizationId: actor.organizationId,
    replacedBy: null,
    ...(filter.status
      ? { status: filter.status }
      : filter.statuses && filter.statuses.length > 0
        ? { status: { in: [...filter.statuses] } }
        : {}),
    ...(filter.type ? { type: filter.type } : {}),
    ...((filter.dateFrom || filter.dateTo) ? { createdAt: { ...(filter.dateFrom ? { gte: filter.dateFrom } : {}), ...(filter.dateTo ? { lte: filter.dateTo } : {}) } } : {}),
    ...(filter.query ? {
      bill: {
        OR: [
          { billNumber: { contains: filter.query, mode: "insensitive" } },
          { title: { contains: filter.query, mode: "insensitive" } },
          { agent: { code: { contains: filter.query, mode: "insensitive" } } },
          { agent: { name: { contains: filter.query, mode: "insensitive" } } },
        ],
      },
    } : {}),
  };
  // แบ่งหน้าตามบิล ไม่ใช่ตามไฟล์ เพื่อไม่ให้หลักฐานของบิลเดียวกันถูกแยกคนละหน้า
  const billGroups = await prisma.billAttachment.groupBy({
    by: ["billId"],
    where,
    _min: { createdAt: true },
    orderBy: { _min: { createdAt: "asc" } },
  });
  const total = billGroups.length;
  const pageBillIds = billGroups
    .slice((page - 1) * pageSize, page * pageSize)
    .map((group) => group.billId);
  const billOrder = new Map(pageBillIds.map((billId, index) => [billId, index]));
  const items = pageBillIds.length === 0 ? [] : await prisma.billAttachment.findMany({
      where: { AND: [where, { billId: { in: pageBillIds } }] },
      orderBy: [{ createdAt: "asc" }],
      select: {
      id: true,
      type: true,
      originalName: true,
      fileSize: true,
      status: true,
      rejectionReason: true,
      createdAt: true,
      verifiedAt: true,
      bill: { select: { id: true, billNumber: true, title: true, status: true, agent: { select: { code: true, name: true } }, draw: { select: { name: true } } } },
      uploadedBy: { select: { displayName: true } },
      verifiedBy: { select: { displayName: true } },
      payment: { select: { amount: true, paidAt: true, paymentMethod: true, bankName: true, transactionReference: true, note: true, verificationStatus: true } },
      },
    });
  items.sort((a, b) => (billOrder.get(a.bill.id) ?? 0) - (billOrder.get(b.bill.id) ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
  return { items, total, page, pageSize };
}

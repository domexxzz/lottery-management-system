-- CreateEnum
CREATE TYPE "AttachmentType" AS ENUM ('ORDER_EVIDENCE', 'PAYMENT_EVIDENCE', 'OTHER');

-- CreateEnum
CREATE TYPE "AttachmentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PaymentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'FILE_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'FILE_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'FILE_REPLACED';
ALTER TYPE "AuditAction" ADD VALUE 'FILE_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'FILE_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_VERIFIED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE 'BILL_SUBMITTED';

-- CreateTable
CREATE TABLE "bill_attachments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "paymentId" TEXT,
    "type" "AttachmentType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "idempotencyKey" TEXT,
    "uploadedById" TEXT NOT NULL,
    "status" "AttachmentStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "replacesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentMethod" TEXT NOT NULL,
    "bankName" TEXT,
    "transactionReference" TEXT,
    "note" TEXT,
    "verificationStatus" "PaymentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bill_attachments_storageKey_key" ON "bill_attachments"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "bill_attachments_idempotencyKey_key" ON "bill_attachments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "bill_attachments_replacesId_key" ON "bill_attachments"("replacesId");

-- CreateIndex
CREATE INDEX "bill_attachments_billId_status_idx" ON "bill_attachments"("billId", "status");

-- CreateIndex
CREATE INDEX "bill_attachments_organizationId_status_createdAt_idx" ON "bill_attachments"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "bill_attachments_organizationId_checksum_idx" ON "bill_attachments"("organizationId", "checksum");

-- CreateIndex
CREATE UNIQUE INDEX "bill_payments_billId_key" ON "bill_payments"("billId");

-- CreateIndex
CREATE INDEX "bill_payments_organizationId_verificationStatus_createdAt_idx" ON "bill_payments"("organizationId", "verificationStatus", "createdAt");

-- CreateIndex
CREATE INDEX "bill_payments_organizationId_transactionReference_idx" ON "bill_payments"("organizationId", "transactionReference");

-- AddForeignKey
ALTER TABLE "bill_attachments" ADD CONSTRAINT "bill_attachments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_attachments" ADD CONSTRAINT "bill_attachments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_attachments" ADD CONSTRAINT "bill_attachments_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "bill_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_attachments" ADD CONSTRAINT "bill_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_attachments" ADD CONSTRAINT "bill_attachments_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_attachments" ADD CONSTRAINT "bill_attachments_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "bill_attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_payments" ADD CONSTRAINT "bill_payments_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Duplicate checks in application code give friendly feedback, while these
-- constraints close the concurrent-upload race at the database boundary.
DROP INDEX "bill_attachments_organizationId_checksum_idx";
CREATE UNIQUE INDEX "bill_attachments_organizationId_checksum_key"
ON "bill_attachments"("organizationId", "checksum");

DROP INDEX "bill_payments_organizationId_transactionReference_idx";
CREATE UNIQUE INDEX "bill_payments_organizationId_transactionReference_key"
ON "bill_payments"("organizationId", "transactionReference");

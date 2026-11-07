-- อนุญาตให้ใช้รูปหลักฐานเดียวกันซ้ำได้ โดยยังเก็บ checksum ไว้ค้นหาและ Audit
DROP INDEX IF EXISTS "bill_attachments_organizationId_checksum_key";
CREATE INDEX "bill_attachments_organizationId_checksum_idx"
ON "bill_attachments"("organizationId", "checksum");

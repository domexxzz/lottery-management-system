-- Owner ลบบัญชีได้: บัญชีที่มีประวัติจะถูกซ่อนด้วย deletedAt แทนการลบจริง
ALTER TYPE "AuditAction" ADD VALUE 'DELETE';
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);

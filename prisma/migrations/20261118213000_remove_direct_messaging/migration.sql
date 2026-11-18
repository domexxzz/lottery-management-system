-- ระบบคงไว้เฉพาะผู้ช่วย AI และประวัติของผู้ช่วย
-- ลบห้องสนทนาระหว่างผู้ใช้ พร้อมข้อความและไฟล์แนบทั้งหมด
DROP TABLE IF EXISTS "direct_message_attachments";
DROP TABLE IF EXISTS "direct_messages";
DROP TABLE IF EXISTS "conversations";

-- คอลัมน์นี้ใช้เฉพาะแสดงสถานะออนไลน์ในระบบข้อความเดิม
ALTER TABLE "users" DROP COLUMN IF EXISTS "lastSeenAt";

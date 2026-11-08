-- เก็บข้อความที่ถูกยกเลิกไว้เป็น tombstone เพื่อรักษาลำดับและประวัติห้องสนทนา
ALTER TABLE "direct_messages"
ADD COLUMN "cancelledAt" TIMESTAMP(3);

ALTER TABLE "agents"
ADD COLUMN "commissionRateUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ข้อมูลเก่าไม่มีประวัติแยกเฉพาะค่าคอม จึงใช้เวลาแก้ Agent ล่าสุดเป็นค่าตั้งต้นที่ใกล้ที่สุด
UPDATE "agents"
SET "commissionRateUpdatedAt" = "updatedAt";

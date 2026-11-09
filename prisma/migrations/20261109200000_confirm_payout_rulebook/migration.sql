-- ยืนยัน Rulebook: เปิดรับเฉพาะ 2 ตัวและ 3 ตัวรวม 6 ประเภท
UPDATE "prize_types"
SET
  "name" = CASE "code"
    WHEN 1 THEN '3 ตัวบนตรง'
    WHEN 2 THEN '3 ตัวบนโต๊ด'
    WHEN 5 THEN '2 ตัวบน'
    WHEN 6 THEN '2 ตัวล่าง'
    WHEN 10 THEN '3 ตัวสลับ'
    WHEN 11 THEN '2 ตัวสลับ'
    ELSE "name"
  END,
  "payoutRate" = CASE "code"
    WHEN 1 THEN 650.0000
    WHEN 2 THEN 100.0000
    WHEN 5 THEN 75.0000
    WHEN 6 THEN 75.0000
    WHEN 10 THEN 100.0000
    WHEN 11 THEN 75.0000
    ELSE "payoutRate"
  END,
  "isActive" = CASE WHEN "code" IN (1, 2, 5, 6, 10, 11) THEN TRUE ELSE FALSE END,
  "updatedAt" = CURRENT_TIMESTAMP;

-- Agent ผู้ขายทุกคนได้ค่าคอม 30% จากยอดเดิมพันรวม
-- Agent ภายในของ Owner/Admin ใช้รหัส SELF-* และยังคง 0%
UPDATE "agents"
SET "commissionRate" = 30.0000, "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" NOT LIKE 'SELF-%';

-- เลขอั้นที่มีอยู่ให้ใช้อัตราครึ่งหนึ่งของ Rulebook ใหม่
UPDATE "restricted_numbers" AS restricted
SET "payoutRate" = prize."payoutRate" / 2
FROM "prize_types" AS prize
WHERE restricted."prizeTypeId" = prize."id"
  AND restricted."kind" = 'REDUCED_RATE';

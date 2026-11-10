-- อัตราจ่ายเลขวิ่งทุกประเภทเป็น 2.5 เท่า (วิ่งบน code 8, วิ่งล่าง code 9)
-- เปลี่ยน Rulebook สำหรับบิลใหม่เท่านั้น บิลที่ยืนยันแล้วรักษา payout snapshot ตอนรับบิล
UPDATE "prize_types"
SET "payoutRate" = 2.5000,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (8, 9);

-- เลขอั้นของเลขวิ่งยังคงนโยบายจ่ายครึ่งหนึ่งของอัตราปกติ
UPDATE "restricted_numbers" AS restricted
SET "payoutRate" = 1.2500
FROM "prize_types" AS prize
WHERE restricted."prizeTypeId" = prize."id"
  AND prize."code" IN (8, 9)
  AND restricted."kind" = 'REDUCED_RATE';

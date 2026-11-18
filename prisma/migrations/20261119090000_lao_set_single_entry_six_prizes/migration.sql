-- หวยลาวชุดรับแทงเป็นเลขชุด 4 หลักเพียงประเภทเดียว (รหัส 201)
-- หนึ่งรายการลุ้น 6 รางวัลและระบบจ่ายเฉพาะรางวัลมูลค่าสูงสุด
UPDATE "prize_types"
SET "isActive" = CASE WHEN "code" = 201 THEN true ELSE false END,
    "updatedAt" = NOW()
WHERE "lotteryType" = 'LAO_SET'
  AND "code" BETWEEN 201 AND 207;

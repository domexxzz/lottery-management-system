-- หวยลาวชุดรับแทงใหม่เฉพาะ 4 ตัวตรง (201) และ 4 ตัวโต๊ด (203)
-- เก็บแถวประเภทเดิมไว้เพื่อให้บิลย้อนหลังยังเปิดดูและตรวจผลได้
UPDATE "prize_types"
SET "isActive" = FALSE, "updatedAt" = NOW()
WHERE "lotteryType" = 'LAO_SET'
  AND "code" NOT IN (201, 203);

UPDATE "prize_types"
SET "isActive" = TRUE, "updatedAt" = NOW()
WHERE "lotteryType" = 'LAO_SET'
  AND "code" IN (201, 203);

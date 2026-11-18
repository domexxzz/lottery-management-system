-- ราคาเหมาหวยลาวชุด 30/60/120 บาท
-- ตรง: 30×850 = 25,500 · โต๊ด: 30×37.5 = 1,125 และเพิ่มตามราคาแพ็กเกจ
UPDATE "prize_types"
SET "payoutRate" = 850.0000, "updatedAt" = NOW()
WHERE "lotteryType" = 'LAO_SET' AND "code" = 201;

UPDATE "prize_types"
SET "payoutRate" = 37.5000, "updatedAt" = NOW()
WHERE "lotteryType" = 'LAO_SET' AND "code" = 203;

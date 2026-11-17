-- DropForeignKey
ALTER TABLE "open_numbers" DROP CONSTRAINT "open_numbers_drawId_fkey";

-- DropForeignKey
ALTER TABLE "open_numbers" DROP CONSTRAINT "open_numbers_prizeTypeId_fkey";

-- DropTable
DROP TABLE "open_numbers";


-- หวยลาวชุดใช้ชื่อเดียวกับหวยลาว: 2 ตัวหน้า = 2 ตัวล่าง, 2 ตัวหลัง = 2 ตัวบน (ไม่ทับชื่อที่ Owner แก้เอง)
UPDATE "prize_types" SET "name" = '2 ตัวล่าง', "updatedAt" = NOW() WHERE "code" = 206 AND "lotteryType" = 'LAO_SET' AND "name" = '2 ตัวหน้า';
UPDATE "prize_types" SET "name" = '2 ตัวบน', "updatedAt" = NOW() WHERE "code" = 207 AND "lotteryType" = 'LAO_SET' AND "name" = '2 ตัวหลัง';

-- เปลี่ยนจาก isPermutation (boolean) เป็น matchRule (enum)
-- เพราะรางวัลประเภท "วิ่ง" ตัดสินด้วยการที่เลขปรากฏอยู่ในผล
-- ซึ่ง boolean เดิมแทนไม่ได้

CREATE TYPE "MatchRule" AS ENUM ('EXACT', 'PERMUTATION', 'CONTAINS_DIGIT');

ALTER TABLE "prize_types" ADD COLUMN "matchRule" "MatchRule" NOT NULL DEFAULT 'EXACT';

-- Backfill ตามหลักการ ไม่อิงรหัสรางวัลที่ hardcode ไว้
--   เดิมเป็นโต๊ด            -> PERMUTATION
--   รับเลขหลักเดียว         -> CONTAINS_DIGIT (รางวัลวิ่ง)
--   นอกนั้น                 -> EXACT (ค่า default)
UPDATE "prize_types" SET "matchRule" = 'PERMUTATION' WHERE "isPermutation" = true;
UPDATE "prize_types" SET "matchRule" = 'CONTAINS_DIGIT' WHERE "digits" = 1 AND "isPermutation" = false;

ALTER TABLE "prize_types" DROP COLUMN "isPermutation";

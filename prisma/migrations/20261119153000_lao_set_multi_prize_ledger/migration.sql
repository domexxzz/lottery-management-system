-- หวยลาวชุด: หนึ่งรายการสามารถถูกรางวัลย่อยได้หลายประเภท
-- ตารางนี้เป็น payout ledger ระดับรายการ ช่วยให้คำนวณซ้ำแบบ idempotent และตรวจสอบย้อนหลังได้
CREATE TABLE "bill_item_winning_prizes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "billItemId" TEXT NOT NULL,
    "prizeTypeId" TEXT NOT NULL,
    "prizeKey" TEXT NOT NULL,
    "prizeLabelSnapshot" TEXT NOT NULL,
    "payoutRateSnapshot" DECIMAL(12,4) NOT NULL,
    "payout" DECIMAL(18,2) NOT NULL,
    "resultValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bill_item_winning_prizes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bill_item_winning_prizes_billItemId_prizeKey_key"
ON "bill_item_winning_prizes"("billItemId", "prizeKey");

CREATE INDEX "bill_item_winning_prizes_organizationId_prizeTypeId_idx"
ON "bill_item_winning_prizes"("organizationId", "prizeTypeId");

CREATE INDEX "bill_item_winning_prizes_organizationId_createdAt_idx"
ON "bill_item_winning_prizes"("organizationId", "createdAt");

ALTER TABLE "bill_item_winning_prizes"
ADD CONSTRAINT "bill_item_winning_prizes_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bill_item_winning_prizes"
ADD CONSTRAINT "bill_item_winning_prizes_billItemId_fkey"
FOREIGN KEY ("billItemId") REFERENCES "bill_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bill_item_winning_prizes"
ADD CONSTRAINT "bill_item_winning_prizes_prizeTypeId_fkey"
FOREIGN KEY ("prizeTypeId") REFERENCES "prize_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- อัตราจ่ายต่อ 1 หน่วย คูณราคาชุดแล้วปัดเป็น 2 ตำแหน่ง จะได้ยอดตามตาราง 30/60/120 บาท
UPDATE "prize_types"
SET "name" = CASE "code"
      WHEN 201 THEN '4 ตัวตรง'
      WHEN 202 THEN '3 ตัวหลังตรง'
      WHEN 203 THEN '4 ตัวโต๊ด'
      WHEN 204 THEN '3 ตัวหลังโต๊ด'
      WHEN 205 THEN '3 ตัวหน้าตรง'
      WHEN 206 THEN '2 ตัวหน้า'
      WHEN 207 THEN '2 ตัวหลัง'
    END,
    "payoutRate" = CASE "code"
      WHEN 201 THEN 850.0000
      WHEN 202 THEN 308.3333
      WHEN 203 THEN 37.5000
      WHEN 204 THEN 30.8333
      WHEN 205 THEN 47.5000
      WHEN 206 THEN 11.6667
      WHEN 207 THEN 11.6667
    END,
    "isActive" = CASE WHEN "code" = 201 THEN true ELSE false END,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "lotteryType" = 'LAO_SET' AND "code" BETWEEN 201 AND 207;

-- เพิ่มรางวัล 3 ตัวหน้าโต๊ดที่เดิมยังไม่มี PrizeType แยกในฐานข้อมูล
INSERT INTO "prize_types" (
  "id", "organizationId", "code", "name", "digits", "resultDigits", "matchRule",
  "lotteryType", "payoutRate", "maxStakePerItem", "isActive", "createdAt", "updatedAt"
)
SELECT
  'lspt_' || md5(o."id" || ':208'), o."id", 208, '3 ตัวหน้าโต๊ด', 3, NULL,
  'PERMUTATION', 'LAO_SET', 14.1667, NULL, false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organizations" o
ON CONFLICT ("organizationId", "code") DO UPDATE
SET "name" = EXCLUDED."name",
    "payoutRate" = EXCLUDED."payoutRate",
    "lotteryType" = EXCLUDED."lotteryType",
    "matchRule" = EXCLUDED."matchRule",
    "isActive" = false,
    "updatedAt" = CURRENT_TIMESTAMP;

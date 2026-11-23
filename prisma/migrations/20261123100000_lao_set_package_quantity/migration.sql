ALTER TABLE "bill_items"
ADD COLUMN "packagePrice" DECIMAL(18,2),
ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;

-- ข้อมูลหวยลาวชุดเดิมคือหนึ่งชุด และ stake เดิมคือราคาต่อชุด
UPDATE "bill_items" AS item
SET "packagePrice" = item."stake"
FROM "prize_types" AS prize
WHERE prize."id" = item."prizeTypeId"
  AND prize."lotteryType" = 'LAO_SET';

ALTER TABLE "bill_items"
ADD CONSTRAINT "bill_items_quantity_positive" CHECK ("quantity" > 0);

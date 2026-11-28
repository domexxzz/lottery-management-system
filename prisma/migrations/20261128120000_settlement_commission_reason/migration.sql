-- เก็บเหตุผลของอัตราคอมไว้กับ Settlement เพื่อให้อธิบายตัวเลขย้อนหลังได้
-- แถวเดิมปล่อยเป็น null/false เพราะไม่มีทางรู้ย้อนหลังว่าตอนนั้นเรตปกติเท่าไหร่
ALTER TABLE "settlements"
ADD COLUMN "commissionBaseRateSnapshot" DECIMAL(7,4),
ADD COLUMN "commissionPromotionApplied" BOOLEAN NOT NULL DEFAULT false;

-- กันบิลซ้ำเมื่อกดยืนยันสองครั้งหรือเครือข่ายส่งคำขอซ้ำ
-- คอลัมน์ว่างได้ บิลเดิมและบิลที่สร้างจากช่องทางอื่นไม่มีค่า (PostgreSQL ยอมให้ NULL ซ้ำใน unique index)
ALTER TABLE "bills" ADD COLUMN "submissionKey" TEXT;

CREATE UNIQUE INDEX "bills_organizationId_submissionKey_key" ON "bills"("organizationId", "submissionKey");

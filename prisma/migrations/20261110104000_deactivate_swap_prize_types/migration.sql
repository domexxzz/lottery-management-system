-- เลขสลับเป็นเพียงปุ่มช่วยสร้าง permutations ของ 3 ตัวบน/2 ตัวบน
-- ไม่ใช่ประเภทรางวัลที่ต้องเปิดรับหรือกรอกผลแยก
UPDATE "prize_types"
SET
  "name" = CASE "code"
    WHEN 10 THEN '3 ตัวสลับ (เดิม)'
    WHEN 11 THEN '2 ตัวสลับ (เดิม)'
    ELSE "name"
  END,
  "isActive" = FALSE,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (10, 11);

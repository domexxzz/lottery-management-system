-- Rulebook มาตรฐานของระบบกำหนดให้:
-- code 8 (วิ่งบน) แทง 1 หลัก แต่ตรวจจากผล 3 ตัวบน
-- code 9 (วิ่งล่าง) แทง 1 หลัก แต่ตรวจจากผล 2 ตัวล่าง
--
-- อัปเดตเฉพาะแถวเดิมที่ยังไม่เคยตั้งค่า เพื่อไม่เขียนทับองค์กรที่ปรับ Rulebook เองแล้ว
UPDATE "prize_types"
SET "resultDigits" = CASE
  WHEN "code" = 8 THEN 3
  WHEN "code" = 9 THEN 2
END
WHERE "code" IN (8, 9)
  AND "matchRule" = 'CONTAINS_DIGIT'
  AND "resultDigits" IS NULL;

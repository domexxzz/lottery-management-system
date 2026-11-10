-- รหัสสลับเดิมเป็นตัวช่วยกรอกเลขตัวบน:
-- 10 ใช้อัตรา 3 ตัวบน 650 และ 11 ใช้อัตรา 2 ตัวบน 75
UPDATE "prize_types"
SET
  "payoutRate" = CASE "code"
    WHEN 10 THEN 650.0000
    WHEN 11 THEN 75.0000
    ELSE "payoutRate"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (10, 11);

-- แก้เฉพาะบิลที่ยังไม่คำนวณผล ไม่เปลี่ยนประวัติของบิลที่ SETTLED/CANCELLED แล้ว
UPDATE "bill_items" AS item
SET "payoutRateSnapshot" = CASE prize."code"
  WHEN 10 THEN 650.0000
  WHEN 11 THEN 75.0000
  ELSE item."payoutRateSnapshot"
END
FROM "prize_types" AS prize, "bills" AS bill
WHERE item."prizeTypeId" = prize."id"
  AND item."billId" = bill."id"
  AND prize."code" IN (10, 11)
  AND bill."status" IN ('CONFIRMED', 'LOCKED');

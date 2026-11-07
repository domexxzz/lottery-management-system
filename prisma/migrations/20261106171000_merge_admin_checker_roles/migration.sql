-- Checker เดิมกลายเป็น Admin เพื่อคงบัญชีและประวัติทั้งหมดไว้
-- คง enum CHECKER ไว้ชั่วคราวสำหรับ backward compatibility กับ Audit/Backup เก่า
UPDATE "users"
SET "role" = 'ADMIN'
WHERE "role" = 'CHECKER';

-- Godmode ถูกถอดออกจากระบบ แต่เก็บแถวผู้ใช้เดิมไว้เพื่อรักษา FK/Audit ย้อนหลัง
-- บัญชีเดิมถูกระงับ ซ่อน เปลี่ยน login ไม่ให้เข้าใช้ได้ และลด enum เป็น Owner ชั่วคราว
UPDATE "users"
SET
  "role" = 'OWNER',
  "status" = 'SUSPENDED',
  "deletedAt" = COALESCE("deletedAt", CURRENT_TIMESTAMP),
  "login" = 'retired-godmode-' || "id",
  "displayName" = 'บัญชีระบบเดิม (ยกเลิก)'
WHERE "role" = 'GODMODE';

ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'AGENT');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
DROP TYPE "Role_old";

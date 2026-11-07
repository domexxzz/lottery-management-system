-- ย้ายบัญชี Checker เดิมเป็น Admin ก่อนลบค่า enum เพื่อรักษาบัญชีและประวัติเดิม
UPDATE "users" SET "role" = 'ADMIN' WHERE "role" = 'CHECKER';

ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'AGENT');
ALTER TABLE "users"
  ALTER COLUMN "role" TYPE "Role"
  USING ("role"::text::"Role");
DROP TYPE "Role_old";

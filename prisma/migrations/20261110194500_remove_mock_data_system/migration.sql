DROP INDEX IF EXISTS "draws_organizationId_isMock_idx";

ALTER TABLE "draws"
DROP COLUMN IF EXISTS "isMock";

ALTER TABLE "organizations"
DROP COLUMN IF EXISTS "mockDataEnabled";

ALTER TABLE "organizations"
ADD COLUMN "mockDataEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "draws"
ADD COLUMN "isMock" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "draws_organizationId_isMock_idx"
ON "draws"("organizationId", "isMock");

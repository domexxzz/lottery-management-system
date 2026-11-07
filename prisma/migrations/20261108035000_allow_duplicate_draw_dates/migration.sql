-- อนุญาตให้สร้างงวดวันที่เดียวกันซ้ำได้ โดยยังคง index สำหรับค้นหางวดตามองค์กร
DROP INDEX IF EXISTS "draws_organizationId_name_key";
CREATE INDEX "draws_organizationId_name_idx" ON "draws"("organizationId", "name");

-- บิลเดียวหลายประเภทหวย: ผู้ใช้เห็นเป็นบิลเดียว เก็บเป็นบิลย่อยต่องวดที่ผูกด้วย slipId
ALTER TABLE "bills" ADD COLUMN "slipId" TEXT;
CREATE INDEX "bills_organizationId_slipId_idx" ON "bills"("organizationId", "slipId");

-- บิลย่อยของ slip เดียวกันใช้เลขบิลเดียวกัน จึงให้ความไม่ซ้ำแยกตามงวด
-- ตัวนับเลขบิลยังออกเลขทีละ 1 ต่อการกดยืนยัน เลขจึงไม่ซ้ำข้ามบิลคนละใบเหมือนเดิม
DROP INDEX IF EXISTS "bills_agentId_sequencePeriod_drawSequence_key";
CREATE UNIQUE INDEX "bills_agentId_sequencePeriod_drawSequence_drawId_key"
  ON "bills"("agentId", "sequencePeriod", "drawSequence", "drawId");

-- รหัสกันกดซ้ำใช้ร่วมกันทุกบิลย่อยของ slip
DROP INDEX IF EXISTS "bills_organizationId_submissionKey_key";
CREATE UNIQUE INDEX "bills_organizationId_submissionKey_drawId_key"
  ON "bills"("organizationId", "submissionKey", "drawId");

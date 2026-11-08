-- รองรับหน้ารายการบิลแบบไม่ระบุสถานะ ทั้งมุมมององค์กรและ Agent
CREATE INDEX "bills_organizationId_createdAt_idx"
ON "bills"("organizationId", "createdAt");

CREATE INDEX "bills_organizationId_agentId_createdAt_idx"
ON "bills"("organizationId", "agentId", "createdAt");

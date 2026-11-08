-- ดัชนีสำหรับหน้ารายการและรายงานที่กรองตามองค์กร แล้วเรียงข้อมูลล่าสุด
CREATE INDEX "draws_organizationId_cutoffAt_idx"
ON "draws"("organizationId", "cutoffAt");

CREATE INDEX "bills_organizationId_status_createdAt_idx"
ON "bills"("organizationId", "status", "createdAt");

CREATE INDEX "bills_organizationId_agentId_status_createdAt_idx"
ON "bills"("organizationId", "agentId", "status", "createdAt");

CREATE INDEX "settlements_organizationId_agentId_drawId_idx"
ON "settlements"("organizationId", "agentId", "drawId");

-- เร่งหน้ารายงานที่เลือกงวดล่าสุดแยกตามประเภทหวย
CREATE INDEX IF NOT EXISTS "draws_organizationId_lotteryType_cutoffAt_idx"
ON "draws"("organizationId", "lotteryType", "cutoffAt");

-- เร่งการรวมยอดรายงวด × Agent และรายชื่อลูกค้าตามสถานะบิล
CREATE INDEX IF NOT EXISTS "bills_organizationId_drawId_agentId_status_idx"
ON "bills"("organizationId", "drawId", "agentId", "status");

CREATE INDEX IF NOT EXISTS "bills_organizationId_agentId_status_title_idx"
ON "bills"("organizationId", "agentId", "status", "title");

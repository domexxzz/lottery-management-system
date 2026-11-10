-- เลขบิลที่ผู้ใช้เห็นนับแยกตาม Agent และเดือนปฏิทินเวลาไทย
ALTER TABLE "bills" ADD COLUMN "sequencePeriod" TEXT;

DROP INDEX IF EXISTS "bills_drawId_drawSequence_key";

-- รองรับข้อมูลเดิม: จัดลำดับใหม่ตาม Agent/เดือนโดยใช้เวลายืนยัน (หรือเวลาสร้างสำหรับข้อมูลเก่า)
WITH ranked AS (
  SELECT
    "id",
    TO_CHAR(COALESCE("confirmedAt", "createdAt") AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM') AS period,
    ROW_NUMBER() OVER (
      PARTITION BY "agentId", TO_CHAR(COALESCE("confirmedAt", "createdAt") AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM')
      ORDER BY COALESCE("confirmedAt", "createdAt"), "createdAt", "id"
    )::INTEGER AS sequence
  FROM "bills"
  WHERE "status" <> 'DRAFT'
)
UPDATE "bills" AS bill
SET
  "sequencePeriod" = ranked.period,
  "drawSequence" = ranked.sequence
FROM ranked
WHERE bill."id" = ranked."id";

CREATE TABLE "agent_bill_counters" (
  "organizationId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "lastSequence" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_bill_counters_pkey" PRIMARY KEY ("agentId", "period")
);

INSERT INTO "agent_bill_counters" ("organizationId", "agentId", "period", "lastSequence", "updatedAt")
SELECT
  "organizationId",
  "agentId",
  "sequencePeriod",
  MAX("drawSequence"),
  CURRENT_TIMESTAMP
FROM "bills"
WHERE "sequencePeriod" IS NOT NULL AND "drawSequence" IS NOT NULL
GROUP BY "organizationId", "agentId", "sequencePeriod";

CREATE UNIQUE INDEX "bills_agentId_sequencePeriod_drawSequence_key"
  ON "bills"("agentId", "sequencePeriod", "drawSequence");
CREATE INDEX "agent_bill_counters_organizationId_period_idx"
  ON "agent_bill_counters"("organizationId", "period");

ALTER TABLE "agent_bill_counters"
  ADD CONSTRAINT "agent_bill_counters_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_bill_counters"
  ADD CONSTRAINT "agent_bill_counters_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

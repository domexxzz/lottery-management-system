CREATE TABLE "agent_commission_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "periodMonth" DATE NOT NULL,
    "thaiCommissionSnapshot" DECIMAL(18,2) NOT NULL,
    "laoCommissionSnapshot" DECIMAL(18,2) NOT NULL,
    "totalCommissionSnapshot" DECIMAL(18,2) NOT NULL,
    "settlementCountSnapshot" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paidById" TEXT,
    "note" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_commission_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agent_commission_payments_organizationId_agentId_periodMonth_key"
ON "agent_commission_payments"("organizationId", "agentId", "periodMonth");

CREATE INDEX "agent_commission_payments_organizationId_periodMonth_voidedAt_idx"
ON "agent_commission_payments"("organizationId", "periodMonth", "voidedAt");

CREATE INDEX "agent_commission_payments_agentId_periodMonth_idx"
ON "agent_commission_payments"("agentId", "periodMonth");

ALTER TABLE "agent_commission_payments"
ADD CONSTRAINT "agent_commission_payments_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_commission_payments"
ADD CONSTRAINT "agent_commission_payments_agentId_fkey"
FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agent_commission_payments"
ADD CONSTRAINT "agent_commission_payments_paidById_fkey"
FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "agent_commission_payments"
ADD CONSTRAINT "agent_commission_payments_voidedById_fkey"
FOREIGN KEY ("voidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "LotteryType" AS ENUM ('THAI_GOVERNMENT');

-- CreateEnum
CREATE TYPE "RestrictionKind" AS ENUM ('CLOSED', 'REDUCED_RATE');

-- AlterTable
ALTER TABLE "draws" ADD COLUMN     "drawDate" DATE,
ADD COLUMN     "lotteryType" "LotteryType" NOT NULL DEFAULT 'THAI_GOVERNMENT';

-- CreateTable
CREATE TABLE "restricted_numbers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "prizeTypeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "RestrictionKind" NOT NULL,
    "payoutRate" DECIMAL(12,4),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restricted_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restricted_numbers_organizationId_drawId_idx" ON "restricted_numbers"("organizationId", "drawId");

-- CreateIndex
CREATE UNIQUE INDEX "restricted_numbers_drawId_prizeTypeId_number_key" ON "restricted_numbers"("drawId", "prizeTypeId", "number");

-- AddForeignKey
ALTER TABLE "restricted_numbers" ADD CONSTRAINT "restricted_numbers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restricted_numbers" ADD CONSTRAINT "restricted_numbers_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "draws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restricted_numbers" ADD CONSTRAINT "restricted_numbers_prizeTypeId_fkey" FOREIGN KEY ("prizeTypeId") REFERENCES "prize_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restricted_numbers" ADD CONSTRAINT "restricted_numbers_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

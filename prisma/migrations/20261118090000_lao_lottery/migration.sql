-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LotteryType" ADD VALUE 'LAO';
ALTER TYPE "LotteryType" ADD VALUE 'LAO_SET';

-- AlterTable
ALTER TABLE "draws" ADD COLUMN     "officialNumber" TEXT;

-- AlterTable
ALTER TABLE "prize_types" ADD COLUMN     "lotteryType" "LotteryType" NOT NULL DEFAULT 'THAI_GOVERNMENT';

-- CreateTable
CREATE TABLE "open_numbers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "prizeTypeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "open_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_cap_overrides" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "drawId" TEXT NOT NULL,
    "prizeTypeId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "cap" DECIMAL(18,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "number_cap_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "open_numbers_organizationId_drawId_idx" ON "open_numbers"("organizationId", "drawId");

-- CreateIndex
CREATE UNIQUE INDEX "open_numbers_drawId_prizeTypeId_number_key" ON "open_numbers"("drawId", "prizeTypeId", "number");

-- CreateIndex
CREATE INDEX "number_cap_overrides_organizationId_drawId_idx" ON "number_cap_overrides"("organizationId", "drawId");

-- CreateIndex
CREATE UNIQUE INDEX "number_cap_overrides_drawId_prizeTypeId_number_key" ON "number_cap_overrides"("drawId", "prizeTypeId", "number");

-- AddForeignKey
ALTER TABLE "open_numbers" ADD CONSTRAINT "open_numbers_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "draws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_numbers" ADD CONSTRAINT "open_numbers_prizeTypeId_fkey" FOREIGN KEY ("prizeTypeId") REFERENCES "prize_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_cap_overrides" ADD CONSTRAINT "number_cap_overrides_drawId_fkey" FOREIGN KEY ("drawId") REFERENCES "draws"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_cap_overrides" ADD CONSTRAINT "number_cap_overrides_prizeTypeId_fkey" FOREIGN KEY ("prizeTypeId") REFERENCES "prize_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


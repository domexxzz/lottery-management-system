-- AlterTable
ALTER TABLE "bills" ADD COLUMN     "cancelRequestReason" TEXT,
ADD COLUMN     "cancelRequestedAt" TIMESTAMP(3),
ADD COLUMN     "cancelRequestedById" TEXT;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_cancelRequestedById_fkey" FOREIGN KEY ("cancelRequestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

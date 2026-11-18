-- เก็บผลการตรวจครบทุกรางวัล แต่เลือกจ่ายเพียงรางวัลสูงสุดต่อ BillItem (Bet ID)
-- DEFAULT true รักษาความหมายของ ledger เดิมโดยไม่แก้ยอด Settlement ย้อนหลัง
ALTER TABLE "bill_item_winning_prizes"
ADD COLUMN "isPaid" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "bill_item_winning_prizes_billItemId_isPaid_idx"
ON "bill_item_winning_prizes"("billItemId", "isPaid");

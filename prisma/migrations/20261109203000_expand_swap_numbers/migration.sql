-- ประเภทสลับแตกทุก permutation เป็นรายการจริง จึงตัดสินแต่ละเลขแบบตรง
UPDATE "prize_types"
SET "matchRule" = 'EXACT', "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" IN (10, 11);

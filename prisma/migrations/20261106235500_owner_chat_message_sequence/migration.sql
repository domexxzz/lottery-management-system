-- ลำดับข้อความต้องแน่นอน แม้ข้อความสองรายการถูกสร้างในมิลลิวินาทีเดียวกัน

ALTER TABLE "owner_chat_messages" ADD COLUMN "sequence" INTEGER;

WITH ordered AS (
    SELECT "id", ROW_NUMBER() OVER (
        PARTITION BY "conversationId"
        ORDER BY "createdAt" ASC, "id" ASC
    ) AS position
    FROM "owner_chat_messages"
)
UPDATE "owner_chat_messages" AS message
SET "sequence" = ordered.position
FROM ordered
WHERE message."id" = ordered."id";

ALTER TABLE "owner_chat_messages" ALTER COLUMN "sequence" SET NOT NULL;

CREATE UNIQUE INDEX "owner_chat_messages_conversationId_sequence_key"
ON "owner_chat_messages"("conversationId", "sequence");

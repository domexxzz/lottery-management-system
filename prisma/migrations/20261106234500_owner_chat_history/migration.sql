-- เก็บประวัติผู้ช่วย AI แยกตาม Owner และองค์กร

CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT');

CREATE TABLE "owner_chat_conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "owner_chat_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "owner_chat_messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "owner_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "owner_chat_conversations_organizationId_ownerId_updatedAt_idx"
ON "owner_chat_conversations"("organizationId", "ownerId", "updatedAt");

CREATE INDEX "owner_chat_messages_conversationId_createdAt_idx"
ON "owner_chat_messages"("conversationId", "createdAt");

ALTER TABLE "owner_chat_conversations"
ADD CONSTRAINT "owner_chat_conversations_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "owner_chat_conversations"
ADD CONSTRAINT "owner_chat_conversations_ownerId_fkey"
FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "owner_chat_messages"
ADD CONSTRAINT "owner_chat_messages_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "owner_chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

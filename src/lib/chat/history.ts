import type { Actor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import type { OwnerChatMessage } from "./schema";

const HISTORY_LIMIT = 30;
const MODEL_CONTEXT_LIMIT = 19;
const TITLE_LIMIT = 72;

export type OwnerConversationSummary = {
  id: string;
  title: string;
  updatedAt: string;
};

export type OwnerConversationDetail = OwnerConversationSummary & {
  messages: Array<OwnerChatMessage & { id: string }>;
};

function titleFrom(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length <= TITLE_LIMIT) return oneLine;
  return `${oneLine.slice(0, TITLE_LIMIT - 1).trimEnd()}…`;
}

function summary(row: { id: string; title: string; updatedAt: Date }): OwnerConversationSummary {
  return { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() };
}

export async function listOwnerConversations(actor: Actor): Promise<OwnerConversationSummary[]> {
  const rows = await prisma.ownerChatConversation.findMany({
    where: { organizationId: actor.organizationId, ownerId: actor.userId },
    orderBy: { updatedAt: "desc" },
    take: HISTORY_LIMIT,
    select: { id: true, title: true, updatedAt: true },
  });
  return rows.map(summary);
}

export async function getOwnerConversation(
  actor: Actor,
  conversationId: string,
): Promise<OwnerConversationDetail | null> {
  const row = await prisma.ownerChatConversation.findFirst({
    where: {
      id: conversationId,
      organizationId: actor.organizationId,
      ownerId: actor.userId,
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        orderBy: { sequence: "asc" },
        select: { id: true, role: true, content: true },
      },
    },
  });
  if (!row) return null;
  return {
    ...summary(row),
    messages: row.messages.map((message) => ({
      id: message.id,
      role: message.role === "USER" ? "user" : "assistant",
      content: message.content,
    })),
  };
}

/** คืนบริบทล่าสุดของห้อง โดยตรวจ owner และ organization ใน query เดียว */
export async function getOwnerConversationContext(
  actor: Actor,
  conversationId: string,
): Promise<OwnerChatMessage[] | null> {
  const row = await prisma.ownerChatConversation.findFirst({
    where: {
      id: conversationId,
      organizationId: actor.organizationId,
      ownerId: actor.userId,
    },
    select: {
      messages: {
        orderBy: { sequence: "desc" },
        take: MODEL_CONTEXT_LIMIT,
        select: { role: true, content: true },
      },
    },
  });
  if (!row) return null;
  return row.messages.reverse().map((message) => ({
    role: message.role === "USER" ? "user" : "assistant",
    content: message.content,
  }));
}

/** บันทึกเป็นคู่หลัง AI ตอบสำเร็จ เพื่อไม่ให้ประวัติมีคำถามที่ไม่มีคำตอบค้างอยู่ */
export async function saveOwnerChatExchange(
  actor: Actor,
  input: {
    conversationId?: string;
    userContent: string;
    assistantContent: string;
  },
): Promise<OwnerConversationSummary | null> {
  return prisma.$transaction(async (tx) => {
    if (input.conversationId) {
      const existing = await tx.ownerChatConversation.findFirst({
        where: {
          id: input.conversationId,
          organizationId: actor.organizationId,
          ownerId: actor.userId,
        },
        select: { id: true },
      });
      if (!existing) return null;

      const aggregate = await tx.ownerChatMessage.aggregate({
        where: { conversationId: existing.id },
        _max: { sequence: true },
      });
      const nextSequence = (aggregate._max.sequence ?? 0) + 1;

      await tx.ownerChatMessage.createMany({
        data: [
          { conversationId: existing.id, role: "USER", content: input.userContent, sequence: nextSequence },
          { conversationId: existing.id, role: "ASSISTANT", content: input.assistantContent, sequence: nextSequence + 1 },
        ],
      });
      const updated = await tx.ownerChatConversation.update({
        where: { id: existing.id },
        data: { updatedAt: new Date() },
        select: { id: true, title: true, updatedAt: true },
      });
      return summary(updated);
    }

    const created = await tx.ownerChatConversation.create({
      data: {
        organizationId: actor.organizationId,
        ownerId: actor.userId,
        title: titleFrom(input.userContent),
        messages: {
          create: [
            { role: "USER", content: input.userContent, sequence: 1 },
            { role: "ASSISTANT", content: input.assistantContent, sequence: 2 },
          ],
        },
      },
      select: { id: true, title: true, updatedAt: true },
    });
    return summary(created);
  });
}

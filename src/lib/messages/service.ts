import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { Actor } from "@/lib/auth/context";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { validateAndProcessEvidenceImage } from "@/lib/evidence/image";
import { getStorageProvider } from "@/lib/storage/provider";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import { CANNOT_CONVERSE_REASON, canConverse, isStaff } from "./policy";

/**
 * ข้อความภายในองค์กร
 *
 * ทุก query ในไฟล์นี้ผูก organizationId เสมอ เหมือนกฎขอบเขตของทั้งระบบ
 * แต่ที่นี่มีกฎเพิ่มอีกชั้นคือใครคุยกับใครได้ ซึ่งอยู่ใน policy.ts
 *
 * ไม่มี realtime ในรุ่นนี้ หน้าจอดึงซ้ำเป็นช่วง ๆ สถานะออนไลน์จึงเป็น
 * "เห็นล่าสุดเมื่อไม่นาน" ไม่ใช่ presence จริง ซึ่งบอกไว้ตรง ๆ ดีกว่า
 * แสดงจุดเขียวที่เชื่อถือไม่ได้
 */

/** ถือว่ายังออนไลน์ถ้าเห็นตัวภายในช่วงนี้ */
export const ONLINE_WINDOW_MS = 2 * 60 * 1000;

const MAX_BODY_LENGTH = 4000;
const MAX_FILES_PER_MESSAGE = 4;

/** เรียง id ให้คงที่ เพื่อให้คู่เดียวกันได้ห้องเดียวเสมอไม่ว่าใครเริ่มก่อน */
function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function isOnline(lastSeenAt: Date | null, now: Date): boolean {
  return lastSeenAt !== null && now.getTime() - lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
}

/**
 * ทำเครื่องหมายว่าเห็นตัวผู้ใช้
 *
 * เรียกจากทุก endpoint ของแชท ถือเป็นสัญญาณชีพที่ถูกที่สุดที่มี
 * โดยไม่ต้องเปิด websocket หรือ job แยก
 */
export async function touchPresence(actor: Actor): Promise<void> {
  await prisma.user.update({
    where: { id: actor.userId },
    data: { lastSeenAt: new Date() },
  });
}

async function userInOrg(actor: Actor, userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId, status: "ACTIVE" },
    select: { id: true, displayName: true, role: true, avatarKey: true, lastSeenAt: true },
  });
  if (!user) throw new NotFoundError("ไม่พบผู้ใช้");
  return user;
}

/**
 * รายชื่อคนที่ผู้ใช้คนนี้ทักได้
 *
 * กรองด้วยกฎเดียวกับตอนส่งข้อความ ไม่ใช่กรองแค่หน้าจอ ถ้าหน้าจอกรองอย่างเดียว
 * คนที่ยิง API ตรงก็ยังทักข้ามได้อยู่ดี
 */
export async function listContacts(actor: Actor, query?: string) {
  const trimmed = query?.trim() ?? "";
  const candidates = await prisma.user.findMany({
    where: {
      organizationId: actor.organizationId,
      status: "ACTIVE",
      id: { not: actor.userId },
      ...(trimmed
        ? { OR: [{ displayName: { contains: trimmed, mode: "insensitive" } }, { login: { contains: trimmed, mode: "insensitive" } }] }
        : {}),
    },
    orderBy: [{ role: "asc" }, { displayName: "asc" }],
    select: { id: true, login: true, displayName: true, role: true, avatarKey: true, lastSeenAt: true },
    take: 50,
  });

  const now = new Date();
  return candidates
    .filter((user) => canConverse(actor.role, user.role))
    .map((user) => ({
      id: user.id,
      login: user.login,
      displayName: user.displayName,
      role: user.role,
      hasAvatar: user.avatarKey !== null,
      online: isOnline(user.lastSeenAt, now),
    }));
}

/** หาห้องที่มีอยู่ หรือสร้างใหม่ถ้ายังไม่มี โดยตรวจสิทธิ์ก่อนเสมอ */
export async function openConversation(actor: Actor, otherUserId: string): Promise<{ conversationId: string }> {
  if (otherUserId === actor.userId) throw new ValidationError("เลือกคู่สนทนาคนอื่น");
  const other = await userInOrg(actor, otherUserId);
  if (!canConverse(actor.role, other.role)) throw new ForbiddenError(CANNOT_CONVERSE_REASON);

  const [userAId, userBId] = orderedPair(actor.userId, otherUserId);
  const existing = await prisma.conversation.findUnique({
    where: { organizationId_userAId_userBId: { organizationId: actor.organizationId, userAId, userBId } },
    select: { id: true },
  });
  if (existing) return { conversationId: existing.id };

  const created = await prisma.conversation.create({
    data: { organizationId: actor.organizationId, userAId, userBId },
    select: { id: true },
  });
  return { conversationId: created.id };
}

/** ห้องที่ผู้ใช้คนนี้อยู่ เรียงจากข้อความล่าสุด พร้อมจำนวนที่ยังไม่อ่าน */
export async function listConversations(actor: Actor) {
  const rows = await prisma.conversation.findMany({
    where: {
      organizationId: actor.organizationId,
      OR: [{ userAId: actor.userId }, { userBId: actor.userId }],
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      userAId: true,
      userBId: true,
      userALastReadAt: true,
      userBLastReadAt: true,
      lastMessageAt: true,
      userA: { select: { id: true, displayName: true, role: true, avatarKey: true, lastSeenAt: true } },
      userB: { select: { id: true, displayName: true, role: true, avatarKey: true, lastSeenAt: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { body: true, senderId: true, createdAt: true, attachments: { select: { id: true }, take: 1 } },
      },
    },
    take: 100,
  });

  const now = new Date();
  const result = [];
  for (const row of rows) {
    const iAmA = row.userAId === actor.userId;
    const other = iAmA ? row.userB : row.userA;
    const myLastRead = iAmA ? row.userALastReadAt : row.userBLastReadAt;
    const unread = await prisma.directMessage.count({
      where: {
        conversationId: row.id,
        senderId: { not: actor.userId },
        ...(myLastRead ? { createdAt: { gt: myLastRead } } : {}),
      },
    });
    const last = row.messages[0];
    result.push({
      id: row.id,
      lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
      unread,
      preview: last ? (last.body?.trim() || (last.attachments.length > 0 ? "ส่งไฟล์แนบ" : "")) : "",
      lastFromMe: last ? last.senderId === actor.userId : false,
      other: {
        id: other.id,
        displayName: other.displayName,
        role: other.role,
        hasAvatar: other.avatarKey !== null,
        online: isOnline(other.lastSeenAt, now),
      },
    });
  }
  return result;
}

/**
 * ตรวจว่าผู้ใช้อยู่ในห้องนี้จริง และคืนข้อมูลที่ต้องใช้ต่อ
 *
 * ตรวจกฎการคุยซ้ำอีกครั้งแม้ห้องจะถูกสร้างไว้แล้ว เพราะบทบาทเปลี่ยนได้ทีหลัง
 * ถ้า Admin ถูกลดเป็น Agent ห้องเก่าที่เคยคุยกับ Agent คนอื่นต้องปิดตัวเอง
 */
async function conversationForActor(actor: Actor, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: {
      id: conversationId,
      organizationId: actor.organizationId,
      OR: [{ userAId: actor.userId }, { userBId: actor.userId }],
    },
    select: {
      id: true,
      userAId: true,
      userBId: true,
      userALastReadAt: true,
      userBLastReadAt: true,
      userA: { select: { id: true, displayName: true, role: true, avatarKey: true, lastSeenAt: true } },
      userB: { select: { id: true, displayName: true, role: true, avatarKey: true, lastSeenAt: true } },
    },
  });
  if (!conversation) throw new NotFoundError("ไม่พบห้องสนทนา");

  const iAmA = conversation.userAId === actor.userId;
  const other = iAmA ? conversation.userB : conversation.userA;
  if (!canConverse(actor.role, other.role)) throw new ForbiddenError(CANNOT_CONVERSE_REASON);
  return { conversation, iAmA, other };
}

/** ข้อความในห้อง พร้อมสถานะว่าอีกฝ่ายอ่านถึงไหนแล้ว */
export async function listMessages(actor: Actor, conversationId: string, limit = 50) {
  const { conversation, iAmA, other } = await conversationForActor(actor, conversationId);
  const otherLastRead = iAmA ? conversation.userBLastReadAt : conversation.userALastReadAt;

  const rows = await prisma.directMessage.findMany({
    where: { conversationId, organizationId: actor.organizationId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: {
      id: true,
      body: true,
      senderId: true,
      createdAt: true,
      attachments: { select: { id: true, originalName: true, mimeType: true, fileSize: true } },
    },
  });

  const now = new Date();
  return {
    other: {
      id: other.id,
      displayName: other.displayName,
      role: other.role,
      hasAvatar: other.avatarKey !== null,
      online: isOnline(other.lastSeenAt, now),
    },
    messages: rows.reverse().map((row) => ({
      id: row.id,
      body: row.body,
      mine: row.senderId === actor.userId,
      createdAt: row.createdAt.toISOString(),
      // อ่านแล้วหมายถึงอีกฝ่ายเปิดห้องหลังข้อความนี้ถูกส่ง
      readByOther:
        row.senderId === actor.userId
        && otherLastRead !== null
        && otherLastRead.getTime() >= row.createdAt.getTime(),
      attachments: row.attachments.map((file) => ({
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        fileSize: file.fileSize,
        isImage: file.mimeType.startsWith("image/"),
      })),
    })),
  };
}

/** บันทึกว่าอ่านถึงตอนนี้แล้ว ทำให้ฝั่งตรงข้ามเห็นสถานะอ่านแล้ว */
export async function markRead(actor: Actor, conversationId: string): Promise<void> {
  const { iAmA } = await conversationForActor(actor, conversationId);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: iAmA ? { userALastReadAt: new Date() } : { userBLastReadAt: new Date() },
  });
}

export type OutgoingFile = {
  fileName: string;
  declaredMimeType: string;
  bytes: Buffer;
};

/**
 * ส่งข้อความ พร้อมไฟล์แนบได้
 *
 * ไฟล์ถูกตรวจและแปลงด้วยท่อเดียวกับหลักฐานบิล ซึ่งเช็กชนิดไฟล์จริงจาก bytes
 * ลบ EXIF และแปลงเป็น WEBP ก่อนเก็บ จึงไม่ต้องเชื่อ mime type ที่ client ส่งมา
 *
 * อัปขึ้น storage ก่อนเปิดทรานแซกชัน เพราะการเขียนไฟล์ช้าและย้อนกลับเองได้
 * ด้วยการลบ object ส่วนแถวในฐานข้อมูลต้องลงพร้อมกันทั้งข้อความและไฟล์แนบ
 */
export async function sendMessage(
  actor: Actor,
  conversationId: string,
  input: { body?: string; files?: OutgoingFile[] },
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<{ messageId: string }> {
  await conversationForActor(actor, conversationId);

  const body = input.body?.trim() ?? "";
  const files = input.files ?? [];
  if (body === "" && files.length === 0) throw new ValidationError("พิมพ์ข้อความหรือแนบไฟล์อย่างน้อยหนึ่งอย่าง");
  if (body.length > MAX_BODY_LENGTH) throw new ValidationError(`ข้อความยาวได้ไม่เกิน ${MAX_BODY_LENGTH} ตัวอักษร`);
  if (files.length > MAX_FILES_PER_MESSAGE) throw new ValidationError(`แนบไฟล์ได้ไม่เกิน ${MAX_FILES_PER_MESSAGE} ไฟล์ต่อข้อความ`);

  const uploaded: { storageKey: string; originalName: string; mimeType: string; fileSize: number }[] = [];
  try {
    for (const file of files) {
      const processed = await validateAndProcessEvidenceImage({
        bytes: file.bytes,
        fileName: file.fileName,
        declaredMimeType: file.declaredMimeType,
      });
      const storageKey = `organizations/${actor.organizationId}/messages/${conversationId}/${randomUUID()}.webp`;
      await storage.upload({
        key: storageKey,
        body: processed.body,
        contentType: processed.mimeType,
        metadata: { sender: actor.userId },
      });
      uploaded.push({
        storageKey,
        originalName: file.fileName,
        mimeType: processed.mimeType,
        fileSize: processed.body.length,
      });
    }

    const created = await prisma.$transaction(async (tx) => {
      const message = await tx.directMessage.create({
        data: {
          organizationId: actor.organizationId,
          conversationId,
          senderId: actor.userId,
          body: body === "" ? null : body,
        },
        select: { id: true, createdAt: true },
      });
      if (uploaded.length > 0) {
        await tx.directMessageAttachment.createMany({
          data: uploaded.map((file) => ({
            organizationId: actor.organizationId,
            messageId: message.id,
            ...file,
          })),
        });
      }
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: message.createdAt },
      });
      return message;
    });

    return { messageId: created.id };
  } catch (error) {
    // เก็บกวาดไฟล์ที่อัปไปแล้ว ไม่งั้นจะเหลือ object กำพร้าที่ไม่มีแถวอ้างถึง
    await Promise.all(uploaded.map((file) => storage.delete(file.storageKey).catch(() => undefined)));
    throw error;
  }
}

/** ลิงก์อายุสั้นสำหรับเปิดไฟล์แนบ ตรวจสิทธิ์ผ่านห้องที่ไฟล์นั้นอยู่ */
export async function signedMessageFileUrl(
  actor: Actor,
  attachmentId: string,
  disposition: "inline" | "attachment",
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<string> {
  const file = await prisma.directMessageAttachment.findFirst({
    where: { id: attachmentId, organizationId: actor.organizationId },
    select: { storageKey: true, originalName: true, message: { select: { conversationId: true } } },
  });
  if (!file) throw new NotFoundError("ไม่พบไฟล์แนบ");
  await conversationForActor(actor, file.message.conversationId);
  if (!(await storage.objectExists(file.storageKey))) throw new NotFoundError("ไม่พบไฟล์ใน Storage");
  return storage.getSignedUrl({ key: file.storageKey, fileName: file.originalName, disposition });
}

/** รูปโปรไฟล์ของผู้ใช้ในองค์กรเดียวกัน ใช้แสดงใน Sidebar และหัวห้อง */
export async function signedAvatarUrl(
  actor: Actor,
  userId: string,
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<string> {
  const user = await prisma.user.findFirst({
    where: { id: userId, organizationId: actor.organizationId },
    select: { avatarKey: true, displayName: true },
  });
  if (!user?.avatarKey) throw new NotFoundError("ผู้ใช้ยังไม่ได้ตั้งรูปโปรไฟล์");
  if (!(await storage.objectExists(user.avatarKey))) throw new NotFoundError("ไม่พบรูปใน Storage");
  return storage.getSignedUrl({ key: user.avatarKey, fileName: `${user.displayName}.webp`, disposition: "inline" });
}

/** ตั้งรูปโปรไฟล์ของตัวเอง เปลี่ยนของคนอื่นไม่ได้ */
export async function setOwnAvatar(
  actor: Actor,
  file: OutgoingFile,
  storage: PrivateObjectStorage = getStorageProvider(),
): Promise<void> {
  const processed = await validateAndProcessEvidenceImage({
    bytes: file.bytes,
    fileName: file.fileName,
    declaredMimeType: file.declaredMimeType,
  });
  const storageKey = `organizations/${actor.organizationId}/avatars/${actor.userId}/${randomUUID()}.webp`;
  await storage.upload({ key: storageKey, body: processed.body, contentType: processed.mimeType });

  const previous = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { avatarKey: true },
  });
  await prisma.user.update({ where: { id: actor.userId }, data: { avatarKey: storageKey } });
  // ลบของเก่าหลังชี้ไปของใหม่แล้ว ถ้าลบก่อนแล้วอัปเดตพัง จะเหลือรูปที่เปิดไม่ได้
  if (previous?.avatarKey) await storage.delete(previous.avatarKey).catch(() => undefined);
}

export type { Role };
export { isStaff };

import { afterAll, beforeEach, describe, expect, test } from "vitest";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import type { PrivateObjectStorage } from "@/lib/storage/types";
import {
  cancelMessage,
  listContacts,
  listConversations,
  listMessages,
  markRead,
  openConversation,
  sendMessage,
  touchPresence,
} from "./service";

/**
 * ข้อความภายในองค์กร
 *
 * สิ่งที่ชุดนี้ต้องพิสูจน์ เรียงตามความสำคัญ
 *   1. Agent คุยกันเองไม่ได้ แม้จะยิงเข้า service ตรง ๆ ไม่ผ่านหน้าจอ
 *   2. ห้องของคู่เดิมต้องเป็นห้องเดียวเสมอ ไม่ว่าใครกดเปิดก่อน
 *   3. สถานะอ่านแล้วต้องสะท้อนความจริง ไม่ใช่ขึ้นอ่านแล้วทั้งที่อีกฝ่ายยังไม่เปิด
 */

let f: Fixtures;

/** storage ปลอม เก็บไว้ในหน่วยความจำ พอให้เส้นทางไฟล์แนบทำงานโดยไม่ต้องมี MinIO */
function fakeStorage() {
  const objects = new Map<string, Buffer>();
  return {
    store: objects,
    provider: {
      upload: async ({ key, body }: { key: string; body: Buffer }) => {
        objects.set(key, body);
      },
      delete: async (key: string) => {
        objects.delete(key);
      },
      objectExists: async (key: string) => objects.has(key),
      download: async (key: string) => objects.get(key)!,
      getObjectMetadata: async (key: string) => ({
        size: objects.get(key)?.length ?? 0,
        contentType: "image/webp",
        metadata: {},
      }),
      getSignedUrl: async ({ key }: { key: string }) => `https://example.test/${key}`,
    } as unknown as PrivateObjectStorage,
  };
}

async function image(color: string): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toBuffer();
}

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ใครคุยกับใครได้ ตรวจที่ชั้น service ไม่ใช่แค่หน้าจอ", () => {
  test("Agent เปิดห้องคุยกับ Agent อีกคนไม่ได้", async () => {
    await expect(
      openConversation(f.actors.AGENT1, f.users.agentUser2.id),
    ).rejects.toThrow(/ตัวแทนคุยกันเองไม่ได้/);
  });

  test("Agent เปิดห้องคุยกับ Owner และ Admin ได้", async () => {
    await expect(openConversation(f.actors.AGENT1, f.users.owner.id)).resolves.toBeDefined();
    await expect(openConversation(f.actors.AGENT1, f.users.admin.id)).resolves.toBeDefined();
  });

  test("Owner คุยได้กับทุกคน รวม Agent ทั้งสองราย", async () => {
    await expect(openConversation(f.actors.OWNER, f.users.agentUser1.id)).resolves.toBeDefined();
    await expect(openConversation(f.actors.OWNER, f.users.agentUser2.id)).resolves.toBeDefined();
  });

  test("รายชื่อผู้ติดต่อของ Agent ไม่มี Agent คนอื่นเลย", async () => {
    const contacts = await listContacts(f.actors.AGENT1);
    const roles = contacts.map((c) => c.role);
    expect(roles).not.toContain("AGENT");
    expect(roles.sort()).toEqual(["ADMIN", "OWNER"]);
  });

  test("รายชื่อผู้ติดต่อของ Owner มี Agent อยู่ด้วย", async () => {
    const contacts = await listContacts(f.actors.OWNER);
    expect(contacts.map((c) => c.role)).toContain("AGENT");
  });

  test("ค้นหาผู้ใช้ยังถูกกรองด้วยกฎเดิม หาเจอก็ทักไม่ได้", async () => {
    const found = await listContacts(f.actors.AGENT1, f.users.agentUser2.displayName);
    expect(found).toHaveLength(0);
  });

  test("ตัวเองไม่อยู่ในรายชื่อผู้ติดต่อ และเปิดห้องคุยกับตัวเองไม่ได้", async () => {
    const contacts = await listContacts(f.actors.OWNER);
    expect(contacts.map((c) => c.id)).not.toContain(f.users.owner.id);
    await expect(openConversation(f.actors.OWNER, f.users.owner.id)).rejects.toThrow(/คู่สนทนาคนอื่น/);
  });
});

describe("ห้องของคู่เดิมต้องเป็นห้องเดียว", () => {
  test("ไม่ว่าใครกดเปิดก่อน ก็ได้ห้องเดียวกัน", async () => {
    const fromOwner = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    const fromAgent = await openConversation(f.actors.AGENT1, f.users.owner.id);
    expect(fromAgent.conversationId).toBe(fromOwner.conversationId);
    expect(await prisma.conversation.count()).toBe(1);
  });

  test("กดเปิดซ้ำหลายครั้งไม่สร้างห้องเพิ่ม", async () => {
    await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    expect(await prisma.conversation.count()).toBe(1);
  });
});

describe("ส่งข้อความและไฟล์แนบ", () => {
  test("ส่งข้อความธรรมดาแล้วอีกฝ่ายเห็น และฝั่งตัวเองขึ้นว่าเป็นของเรา", async () => {
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await sendMessage(f.actors.OWNER, conversationId, { body: "ส่งยอดวันนี้ด้วยครับ" });

    const mine = await listMessages(f.actors.OWNER, conversationId);
    expect(mine.messages).toHaveLength(1);
    expect(mine.messages[0]!.mine).toBe(true);
    expect(mine.messages[0]!.body).toBe("ส่งยอดวันนี้ด้วยครับ");

    const theirs = await listMessages(f.actors.AGENT1, conversationId);
    expect(theirs.messages[0]!.mine).toBe(false);
    expect(theirs.other.displayName).toBe(f.users.owner.displayName);
  });

  test("ส่งรูปโดยไม่มีข้อความได้ และไฟล์ถูกเก็บลง storage", async () => {
    const storage = fakeStorage();
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await sendMessage(
      f.actors.OWNER,
      conversationId,
      { files: [{ fileName: "slip.png", declaredMimeType: "image/png", bytes: await image("#2277cc") }] },
      storage.provider,
    );

    const listed = await listMessages(f.actors.AGENT1, conversationId);
    expect(listed.messages[0]!.body).toBeNull();
    expect(listed.messages[0]!.attachments).toHaveLength(1);
    expect(listed.messages[0]!.attachments[0]!.isImage).toBe(true);
    expect(storage.store.size).toBe(1);
  });

  test("ข้อความว่างและไม่มีไฟล์ถูกปฏิเสธ", async () => {
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await expect(sendMessage(f.actors.OWNER, conversationId, { body: "   " })).rejects.toThrow(/อย่างน้อยหนึ่งอย่าง/);
  });

  test("คนนอกห้องส่งข้อความเข้าห้องไม่ได้", async () => {
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await expect(
      sendMessage(f.actors.AGENT2, conversationId, { body: "แอบส่ง" }),
    ).rejects.toThrow(/ไม่พบห้องสนทนา/);
    await expect(listMessages(f.actors.AGENT2, conversationId)).rejects.toThrow(/ไม่พบห้องสนทนา/);
  });

  test("ส่งไฟล์ล้มเหลว ต้องไม่เหลือไฟล์กำพร้าใน storage", async () => {
    const storage = fakeStorage();
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await expect(
      sendMessage(
        f.actors.OWNER,
        conversationId,
        { files: [{ fileName: "bad.txt", declaredMimeType: "text/plain", bytes: Buffer.from("not an image") }] },
        storage.provider,
      ),
    ).rejects.toThrow();
    expect(storage.store.size).toBe(0);
    expect(await prisma.directMessage.count()).toBe(0);
  });

  test("ผู้ส่งยกเลิกข้อความแล้วทั้งสองฝั่งเห็น tombstone และไม่มีเนื้อหา", async () => {
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    const sent = await sendMessage(f.actors.OWNER, conversationId, { body: "ข้อความที่ต้องยกเลิก" });

    await cancelMessage(f.actors.OWNER, conversationId, sent.messageId);

    const mine = (await listMessages(f.actors.OWNER, conversationId)).messages[0]!;
    const theirs = (await listMessages(f.actors.AGENT1, conversationId)).messages[0]!;
    expect(mine.body).toBeNull();
    expect(mine.cancelledAt).not.toBeNull();
    expect(theirs.body).toBeNull();
    expect(theirs.cancelledAt).not.toBeNull();
    expect((await listConversations(f.actors.AGENT1))[0]!.preview).toBe("ยกเลิกข้อความแล้ว");
  });

  test("ยกเลิกได้เฉพาะข้อความของตนเอง", async () => {
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    const sent = await sendMessage(f.actors.OWNER, conversationId, { body: "ห้ามอีกฝ่ายยกเลิก" });

    await expect(cancelMessage(f.actors.AGENT1, conversationId, sent.messageId)).rejects.toThrow(/เฉพาะข้อความที่คุณส่ง/);
  });

  test("ยกเลิกข้อความที่มีรูปแล้วลบทั้งไฟล์แนบและ object ใน storage", async () => {
    const storage = fakeStorage();
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    const sent = await sendMessage(
      f.actors.OWNER,
      conversationId,
      { files: [{ fileName: "cancel.png", declaredMimeType: "image/png", bytes: await image("#33aa77") }] },
      storage.provider,
    );

    await cancelMessage(f.actors.OWNER, conversationId, sent.messageId, storage.provider);

    expect(storage.store.size).toBe(0);
    expect((await listMessages(f.actors.OWNER, conversationId)).messages[0]!.attachments).toHaveLength(0);
    expect(await prisma.directMessageAttachment.count({ where: { messageId: sent.messageId } })).toBe(0);
  });
});

describe("สถานะอ่านแล้วและจำนวนที่ยังไม่อ่าน", () => {
  test("อีกฝ่ายยังไม่เปิดห้อง ต้องยังไม่ขึ้นว่าอ่านแล้ว", async () => {
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await sendMessage(f.actors.OWNER, conversationId, { body: "ทักไปก่อน" });

    const beforeRead = await listMessages(f.actors.OWNER, conversationId);
    expect(beforeRead.messages[0]!.readByOther).toBe(false);

    await markRead(f.actors.AGENT1, conversationId);
    const afterRead = await listMessages(f.actors.OWNER, conversationId);
    expect(afterRead.messages[0]!.readByOther).toBe(true);
  });

  test("จำนวนที่ยังไม่อ่านนับเฉพาะข้อความของอีกฝ่าย", async () => {
    const { conversationId } = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    await sendMessage(f.actors.OWNER, conversationId, { body: "หนึ่ง" });
    await sendMessage(f.actors.OWNER, conversationId, { body: "สอง" });
    await sendMessage(f.actors.AGENT1, conversationId, { body: "ตอบกลับ" });

    const agentView = await listConversations(f.actors.AGENT1);
    expect(agentView[0]!.unread).toBe(2);

    // ของตัวเองไม่นับเป็นยังไม่อ่าน
    const ownerView = await listConversations(f.actors.OWNER);
    expect(ownerView[0]!.unread).toBe(1);

    await markRead(f.actors.AGENT1, conversationId);
    expect((await listConversations(f.actors.AGENT1))[0]!.unread).toBe(0);
  });

  test("ห้องเรียงจากข้อความล่าสุด และมีตัวอย่างข้อความให้เห็น", async () => {
    const first = await openConversation(f.actors.OWNER, f.users.agentUser1.id);
    const second = await openConversation(f.actors.OWNER, f.users.agentUser2.id);
    await sendMessage(f.actors.OWNER, first.conversationId, { body: "ห้องแรก" });
    await sendMessage(f.actors.OWNER, second.conversationId, { body: "ห้องหลัง" });

    const rooms = await listConversations(f.actors.OWNER);
    expect(rooms[0]!.id).toBe(second.conversationId);
    expect(rooms[0]!.preview).toBe("ห้องหลัง");
    expect(rooms[0]!.lastFromMe).toBe(true);
  });
});

describe("สถานะออนไลน์", () => {
  test("ผู้ใช้ที่เพิ่งเห็นตัวขึ้นออนไลน์ ส่วนคนที่ยังไม่เคยเข้าไม่ขึ้น", async () => {
    await touchPresence(f.actors.AGENT1);

    const contacts = await listContacts(f.actors.OWNER);
    const agent1 = contacts.find((c) => c.id === f.users.agentUser1.id);
    const agent2 = contacts.find((c) => c.id === f.users.agentUser2.id);
    expect(agent1?.online).toBe(true);
    expect(agent2?.online).toBe(false);
  });
});

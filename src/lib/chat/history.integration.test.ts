import { afterAll, beforeEach, describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { freshFixtures, type Fixtures } from "@/test/fixtures";
import {
  getOwnerConversation,
  getOwnerConversationContext,
  listOwnerConversations,
  saveOwnerChatExchange,
} from "./history";

let f: Fixtures;

beforeEach(async () => {
  f = await freshFixtures();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("ประวัติการสนทนาของ Owner", () => {
  test("สร้างห้องจากคำถามแรกและเปิดอ่านข้อความตามลำดับ", async () => {
    const created = await saveOwnerChatExchange(f.actors.OWNER, {
      userContent: "ช่วยสรุปยอดขายรอบล่าสุดให้หน่อย",
      assistantContent: "ยอดขายรวม 100.00 บาท",
    });
    expect(created).not.toBeNull();

    const detail = await getOwnerConversation(f.actors.OWNER, created!.id);
    expect(detail?.title).toBe("ช่วยสรุปยอดขายรอบล่าสุดให้หน่อย");
    expect(detail?.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "ช่วยสรุปยอดขายรอบล่าสุดให้หน่อย" },
      { role: "assistant", content: "ยอดขายรวม 100.00 บาท" },
    ]);
  });

  test("ถามต่อในห้องเดิมและบริบทถูกเรียงตามเวลา", async () => {
    const created = await saveOwnerChatExchange(f.actors.OWNER, {
      userContent: "สรุปรอบล่าสุด",
      assistantContent: "รอบเปิดรับอยู่",
    });
    await saveOwnerChatExchange(f.actors.OWNER, {
      conversationId: created!.id,
      userContent: "แล้วมีบิลกี่ใบ",
      assistantContent: "มี 2 บิล",
    });

    await expect(getOwnerConversationContext(f.actors.OWNER, created!.id)).resolves.toEqual([
      { role: "user", content: "สรุปรอบล่าสุด" },
      { role: "assistant", content: "รอบเปิดรับอยู่" },
      { role: "user", content: "แล้วมีบิลกี่ใบ" },
      { role: "assistant", content: "มี 2 บิล" },
    ]);
  });

  test("บัญชีอื่นเปิดประวัติของ Owner ไม่ได้", async () => {
    const created = await saveOwnerChatExchange(f.actors.OWNER, {
      userContent: "สรุปงานค้าง",
      assistantContent: "ไม่มีงานค้าง",
    });
    const otherActor = { ...f.actors.OWNER, userId: f.actors.ADMIN.userId };

    await expect(getOwnerConversation(otherActor, created!.id)).resolves.toBeNull();
    await expect(getOwnerConversationContext(otherActor, created!.id)).resolves.toBeNull();
    await expect(listOwnerConversations(otherActor)).resolves.toEqual([]);
  });

  test("รายการประวัติเรียงห้องที่อัปเดตล่าสุดก่อน", async () => {
    const first = await saveOwnerChatExchange(f.actors.OWNER, {
      userContent: "ห้องแรก",
      assistantContent: "คำตอบแรก",
    });
    const second = await saveOwnerChatExchange(f.actors.OWNER, {
      userContent: "ห้องที่สอง",
      assistantContent: "คำตอบที่สอง",
    });
    await saveOwnerChatExchange(f.actors.OWNER, {
      conversationId: first!.id,
      userContent: "ถามห้องแรกต่อ",
      assistantContent: "คำตอบต่อ",
    });

    const rows = await listOwnerConversations(f.actors.OWNER);
    expect(rows[0]?.id).toBe(first!.id);
    expect(rows.map((row) => row.id)).toContain(second!.id);
  });
});

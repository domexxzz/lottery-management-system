import { describe, expect, it } from "vitest";
import { ownerChatRequestSchema } from "./schema";
import {
  extractTyphoonError,
  extractTyphoonText,
  isTyphoonAuthFailure,
} from "./typhoon-response";

describe("ownerChatRequestSchema", () => {
  it("accepts a valid owner conversation", () => {
    expect(ownerChatRequestSchema.safeParse({ message: "สรุปยอดขาย" }).success).toBe(true);
    expect(ownerChatRequestSchema.safeParse({ conversationId: "cm1234567890", message: "ถามต่อ" }).success).toBe(true);
  });

  it("rejects empty and oversized messages", () => {
    expect(ownerChatRequestSchema.safeParse({ message: "   " }).success).toBe(false);
    expect(ownerChatRequestSchema.safeParse({ message: "ก".repeat(2_001) }).success).toBe(false);
  });

  it("rejects malformed conversation ids and legacy message arrays", () => {
    expect(ownerChatRequestSchema.safeParse({ conversationId: "short", message: "ถาม" }).success).toBe(false);
    expect(ownerChatRequestSchema.safeParse({ messages: [{ role: "user", content: "x" }] }).success).toBe(false);
  });
});

describe("extractTyphoonText", () => {
  it("อ่านข้อความจาก Chat Completions API", () => {
    expect(extractTyphoonText({ choices: [{ message: { content: "พร้อมใช้งาน" } }] })).toBe("พร้อมใช้งาน");
  });

  it("returns null when the provider does not return text", () => {
    expect(extractTyphoonText({ choices: [] })).toBeNull();
  });
});

describe("extractTyphoonError", () => {
  it("อ่านข้อความแบบ object", () => {
    expect(extractTyphoonError({ error: { message: "bad model" } })).toBe("bad model");
  });

  it("อ่านข้อความแบบ string ที่ผู้ให้บริการตอบจริง", () => {
    // รองรับกรณีผู้ให้บริการส่ง error เป็น string แทน object
    expect(extractTyphoonError({ error: "Incorrect API key provided." })).toBe("Incorrect API key provided.");
  });

  it("ไม่มีข้อความก็ยังได้รหัสไว้วินิจฉัย", () => {
    expect(extractTyphoonError({ code: "invalid-argument" })).toBe("invalid-argument");
    expect(extractTyphoonError({})).toBe("unknown");
  });
});

describe("isTyphoonAuthFailure — แยกคีย์ผิดออกจากคำขอผิด", () => {
  it("401 และ 403 คือคีย์ผิดแน่นอน", () => {
    expect(isTyphoonAuthFailure(401, "")).toBe(true);
    expect(isTyphoonAuthFailure(403, "")).toBe(true);
  });

  it("400 ที่พูดถึง API key ก็คือคีย์ผิด", () => {
    // ผู้ให้บริการตอบ 400 เมื่อคีย์ผิด ถ้าดูแต่สถานะจะวินิจฉัยเป็นโมเดลผิด
    expect(isTyphoonAuthFailure(400, "Incorrect API key provided.")).toBe(true);
    expect(isTyphoonAuthFailure(400, "Unauthorized")).toBe(true);
  });

  it("400 ที่พูดถึงโมเดล ไม่ใช่เรื่องคีย์", () => {
    expect(isTyphoonAuthFailure(400, "model typhoon-x does not exist")).toBe(false);
    expect(isTyphoonAuthFailure(404, "not found")).toBe(false);
  });
});

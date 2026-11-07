import { z } from "zod";

export const ownerChatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1, "ข้อความต้องไม่ว่าง").max(2_000, "ข้อความยาวเกิน 2,000 ตัวอักษร"),
});

export const ownerChatRequestSchema = z.object({
  conversationId: z.string().trim().min(10).max(64).optional(),
  message: z.string().trim().min(1, "ข้อความต้องไม่ว่าง").max(2_000, "ข้อความยาวเกิน 2,000 ตัวอักษร"),
});

export type OwnerChatMessage = z.infer<typeof ownerChatMessageSchema>;

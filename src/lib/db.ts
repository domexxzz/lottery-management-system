import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    // ตรวจตั้งแต่ตอนสร้าง client เพื่อให้ล้มตั้งแต่ startup ไม่ใช่ตอน query แรก (LOT-60)
    throw new Error("ไม่ได้ตั้งค่า DATABASE_URL — ดูตัวอย่างใน .env.example");
  }

  const schema = new URL(connectionString).searchParams.get("schema") ?? undefined;

  return new PrismaClient({
    // Prisma 7 driver adapters do not infer `?schema=` from the connection URL.
    // Passing it explicitly keeps development and integration-test schemas isolated.
    adapter: new PrismaPg({ connectionString }, schema ? { schema } : undefined),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createClient();

/**
 * Schema ที่ client ตัวนี้ทำงานอยู่
 *
 * Prisma แปลชื่อตารางให้เองเฉพาะคิวรีที่ผ่าน query builder
 * แต่ $queryRaw ส่ง SQL ดิบไปตรง ๆ จึงไม่ได้ schema ติดไปด้วย
 * ถ้าไม่ระบุ ตารางจะถูกมองหาใน search_path ซึ่งชี้ไป public
 * ทำให้ integration test ที่รันใน schema แยกไปอ่านฐาน development แทนโดยเงียบ ๆ
 */
export function databaseSchema(): string {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return "public";
  return new URL(connectionString).searchParams.get("schema") ?? "public";
}

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

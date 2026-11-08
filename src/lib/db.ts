import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// เพิ่มเลขนี้ทุกครั้งที่ schema เปลี่ยน เพื่อให้ next dev ทิ้ง Prisma Client
// ที่ cache ไว้จาก generated client รุ่นก่อนหน้า
/*
 * หมายเหตุสำหรับคนที่แก้ schema
 *
 * ค่านี้สร้าง PrismaClient ตัวใหม่เมื่อเปลี่ยน แต่ช่วยได้เฉพาะกรณีที่ client
 * ที่ generate ไว้บนดิสก์ถูกต้องแล้ว ถ้า dev server รันค้างอยู่ตั้งแต่ก่อน
 * prisma generate มันจะถือโมดูลเก่าในหน่วยความจำ แล้วพ่น
 * PrismaClientValidationError ว่าไม่รู้จักฟิลด์ใหม่ ซึ่งอ่านแล้วเหมือนโค้ดผิด
 *
 * กรณีนั้นต้องรีสตาร์ต dev server สถานเดียว package.json จึงมี predev
 * ที่สั่ง prisma generate ให้ทุกครั้งก่อนเริ่ม เพื่อไม่ให้เกิดซ้ำ
 */
const PRISMA_SCHEMA_VERSION = 3;
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaSchemaVersion?: number;
};

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

const cachedClientIsCurrent =
  globalForPrisma.prisma !== undefined
  && globalForPrisma.prismaSchemaVersion === PRISMA_SCHEMA_VERSION;

export const prisma = cachedClientIsCurrent ? globalForPrisma.prisma! : createClient();

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
  if (!cachedClientIsCurrent && globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect();
  }
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaSchemaVersion = PRISMA_SCHEMA_VERSION;
}

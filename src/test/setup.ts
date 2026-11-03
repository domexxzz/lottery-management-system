import "dotenv/config";

/**
 * โหลด .env ให้ integration test เห็น DATABASE_URL
 *
 * ล้มทันทีถ้าไม่มี เพื่อไม่ให้เข้าใจผิดว่า test ผ่านทั้งที่ไม่ได้ต่อฐานข้อมูล
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    "integration test ต้องมี DATABASE_URL — รัน npm run db:up แล้ว npx prisma migrate deploy ก่อน",
  );
}

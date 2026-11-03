import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Integration test — รันกับ PostgreSQL จริง
 *
 * ต้องมี DATABASE_URL และฐานข้อมูลที่ migrate แล้ว
 * บนเครื่อง: npm run db:up && npx prisma migrate deploy
 *
 * รันทีละไฟล์แบบไม่ขนาน เพราะทุกไฟล์ล้างและสร้างข้อมูลในฐานเดียวกัน
 * ถ้ารันพร้อมกันจะกวนกันเอง
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    // ติดต่อฐานข้อมูลจริง จึงช้ากว่า unit test
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});

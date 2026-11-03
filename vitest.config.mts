import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit test — ไม่แตะฐานข้อมูล รันเร็วและรันขนานได้
 *
 * ไฟล์ *.integration.test.ts ถูกกันออกจากชุดนี้ เพราะต้องมี PostgreSQL
 * ดู vitest.integration.config.ts
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});

import "dotenv/config";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const developmentUrl = process.env.DATABASE_URL;
const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  throw new Error(
    "ไม่พบ TEST_DATABASE_URL — กำหนด schema integration_test ตามตัวอย่างใน .env.example",
  );
}

const parsedTestUrl = new URL(testUrl);
const schema = parsedTestUrl.searchParams.get("schema");

if (!schema?.startsWith("integration_test")) {
  throw new Error(
    "TEST_DATABASE_URL ต้องใช้ schema ที่ขึ้นต้นด้วย integration_test เท่านั้น",
  );
}

if (testUrl === developmentUrl) {
  throw new Error("TEST_DATABASE_URL ต้องไม่ซ้ำกับ DATABASE_URL");
}

const prismaCli = fileURLToPath(
  new URL("../node_modules/prisma/build/index.js", import.meta.url),
);
const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  env: { ...process.env, DATABASE_URL: testUrl },
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  throw new Error(`เตรียมฐานข้อมูล integration test ไม่สำเร็จ (exit ${result.status})`);
}

import "dotenv/config";

/**
 * โหลด .env และบังคับให้ integration test ใช้ schema แยกจาก development
 *
 * ล้มทันทีถ้าไม่มี เพื่อไม่ให้เข้าใจผิดว่า test ผ่านทั้งที่ไม่ได้ต่อฐานข้อมูล
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "integration test ต้องมี TEST_DATABASE_URL ที่ชี้ไปยัง schema integration_test",
  );
}

const testDatabaseUrl = new URL(process.env.TEST_DATABASE_URL);
const testSchema = testDatabaseUrl.searchParams.get("schema");

if (!testSchema?.startsWith("integration_test")) {
  throw new Error(
    "TEST_DATABASE_URL ต้องใช้ schema ที่ขึ้นต้นด้วย integration_test เพื่อป้องกันข้อมูล development",
  );
}

if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL ต้องแยกจาก DATABASE_URL");
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;

// ชุดทดสอบเดิมเน้นวงจรบิลและการเงินและสร้างบิลโดยไม่แตะ Object Storage
// ปิด business rule นี้เฉพาะค่าเริ่มต้นของ test; ชุด evidence.integration เปิดกลับและทดสอบจริงกับ MinIO
process.env.BILL_ORDER_EVIDENCE_REQUIRED = "false";
process.env.BILL_PAYMENT_EVIDENCE_REQUIRED = "false";

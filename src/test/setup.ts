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

/**
 * บังคับให้ integration test ใช้ MinIO ในเครื่องเสมอ ไม่ว่า .env จะตั้งอะไรไว้
 *
 * เหตุผลเดียวกับด่าน TEST_DATABASE_URL ข้างบน ชุด evidence อัปโหลดไฟล์จริง
 * และ afterEach ของมันลบ object ทิ้งทุกครั้ง ถ้า .env ชี้ไปที่เก็บไฟล์ของ
 * production เทสจะเขียนและลบไฟล์จริงของลูกค้าโดยไม่มีอะไรเตือน
 *
 * เคยเกิดขึ้นมาแล้วตอนมีคนเปลี่ยน .env ไปชี้ S3 จริงเพื่อเตรียม deploy
 * ปรับผ่าน TEST_STORAGE_* ได้ถ้าใครรัน MinIO คนละพอร์ตหรือคนละรหัส
 */
process.env.STORAGE_PROVIDER = "minio";
process.env.STORAGE_ENDPOINT = process.env.TEST_STORAGE_ENDPOINT ?? "http://127.0.0.1:9000";
process.env.STORAGE_REGION = process.env.TEST_STORAGE_REGION ?? "us-east-1";
process.env.STORAGE_BUCKET = process.env.TEST_STORAGE_BUCKET ?? "bill-private";
/*
 * คีย์ไม่ override ด้วยค่าตายตัว เพราะ docker-compose.yml อ่าน .env เองแล้วใช้
 * STORAGE_ACCESS_KEY/SECRET_KEY เป็น root user ของ MinIO ที่รันในเครื่อง
 * ถ้าฮาร์ดโค้ดไว้ พอมีคนเปลี่ยน .env คีย์จะไม่ตรงกับ container แล้วเข้าไม่ได้
 * ใช้ชุดเดียวกับที่ container ถูกสร้างขึ้นมาจึงถูกต้องเสมอ
 */
process.env.STORAGE_ACCESS_KEY =
  process.env.TEST_STORAGE_ACCESS_KEY ?? process.env.STORAGE_ACCESS_KEY ?? "minio_dev_only";
process.env.STORAGE_SECRET_KEY =
  process.env.TEST_STORAGE_SECRET_KEY ?? process.env.STORAGE_SECRET_KEY ?? "minio_dev_secret_only";
process.env.STORAGE_FORCE_PATH_STYLE = "true";

/** กันพลาดอีกชั้น ต่อให้มีคนตั้ง TEST_STORAGE_ENDPOINT ไปที่อื่นก็ต้องไม่ออกนอกเครื่อง */
const storageHost = new URL(process.env.STORAGE_ENDPOINT).hostname;
if (storageHost !== "localhost" && storageHost !== "127.0.0.1" && storageHost !== "::1") {
  throw new Error(
    `integration test ต้องใช้ที่เก็บไฟล์ในเครื่องเท่านั้น แต่ STORAGE_ENDPOINT ชี้ไป ${storageHost}`,
  );
}

import "dotenv/config";
import { runDailySummary } from "../src/lib/notify/daily-summary";
import { prisma } from "../src/lib/db";

/**
 * ส่งสรุปรายวันเข้า Telegram
 *
 *   npm run job:daily-summary
 *
 * เรียกซ้ำได้ปลอดภัย ส่งวันละครั้งเท่านั้นเพราะกันด้วยวันที่ใน Audit
 * ตั้ง scheduler ให้เรียกตอนเช้าได้เลย หรือเรียกถี่กว่านั้นก็ไม่ซ้ำ
 */
async function main() {
  const outcome = await runDailySummary();

  switch (outcome.skippedReason) {
    case "ALREADY_SENT":
      console.log(`ส่งสรุปของวันที่ ${outcome.date} ไปแล้ว ไม่ส่งซ้ำ`);
      return;
    case "NO_ORGANIZATION":
      console.error("ไม่พบองค์กรที่เปิดใช้งาน — รัน npm run db:seed ก่อน");
      process.exitCode = 1;
      return;
    case "NO_OWNER":
      console.error("ไม่พบผู้ใช้บทบาท Owner ที่ใช้งานอยู่ จึงอ่านข้อมูลสรุปไม่ได้");
      process.exitCode = 1;
      return;
    case "SEND_FAILED":
      console.error(`ส่งไม่สำเร็จ จะลองใหม่รอบหน้า: ${outcome.detail ?? ""}`);
      process.exitCode = 1;
      return;
    default:
      console.log(`ส่งสรุปของวันที่ ${outcome.date} แล้ว`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

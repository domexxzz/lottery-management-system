import "dotenv/config";
import { lockDueDraws } from "../src/lib/draws/service";
import { prisma } from "../src/lib/db";

/**
 * รัน cutoff job จากบรรทัดคำสั่ง
 *
 * ใช้เมื่อยังไม่มี scheduler จริง หรือเมื่อต้องตามเก็บรอบที่ค้าง
 * ตั้ง cron ให้เรียกทุกนาที: npm run job:cutoff
 */
async function main() {
  const result = await lockDueDraws();

  if (result.locked.length === 0 && result.failed.length === 0) {
    console.log("ไม่มีรอบที่ถึงเวลาปิดรับ");
    return;
  }

  for (const outcome of result.locked) {
    console.log(
      `ปิดรอบ "${outcome.drawName}" แล้ว · ล็อกบิล ${outcome.billsLocked} ใบ · ยกเลิกร่างค้าง ${outcome.draftsCancelled} ใบ`,
    );
  }

  for (const failure of result.failed) {
    console.error(`ปิดรอบ ${failure.drawId} ไม่สำเร็จ: ${failure.error}`);
  }

  if (result.failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

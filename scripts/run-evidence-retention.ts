import "dotenv/config";
import { purgeExpiredEvidence } from "../src/lib/evidence/retention";
import { prisma } from "../src/lib/db";

/**
 * ลบรูปหลักฐานที่แนบมาครบ 1 ปีแล้ว
 *
 * ตั้ง cron ให้เรียกวันละครั้ง: npm run job:evidence-retention
 * (ถ้ายังไม่ได้ตั้ง หน้าตรวจหลักฐานจะลบให้เองเมื่อมีคนเปิด อย่างมากชั่วโมงละครั้ง)
 */
async function main() {
  const { deleted } = await purgeExpiredEvidence();
  console.log(deleted === 0 ? "ไม่มีรูปหลักฐานที่ครบ 1 ปี" : `ลบรูปหลักฐานที่ครบ 1 ปีแล้ว ${deleted} รูป`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import "dotenv/config";
import { runEvidenceAlerts, type EvidenceAlertOutcome } from "../src/lib/notify/evidence-alerts";
import { runDailySummary } from "../src/lib/notify/daily-summary";
import { processTelegramInbox } from "../src/lib/notify/telegram-inbox";
import { prisma } from "../src/lib/db";

/**
 * ส่งแจ้งเตือนหลักฐานที่รอตรวจ
 *
 *   npm run job:notify          รันหนึ่งรอบแล้วจบ — เหมาะกับ cron หรือ Task Scheduler
 *   npm run job:notify:watch    รันวนไปเรื่อย ๆ — เหมาะกับตอนพัฒนา เปิดทิ้งไว้ในเทอร์มินัล
 *
 * โหมด watch มีไว้เพื่อความสะดวกตอน dev ไม่ใช่สำหรับ production
 * ของจริงควรให้ scheduler ของระบบปฏิบัติการหรือของผู้ให้บริการเป็นคนเรียก
 * เพราะมันดูแลการรีสตาร์ตเมื่อเครื่องดับให้เอง ซึ่ง process ที่เปิดค้างไว้ทำไม่ได้
 */

const DEFAULT_INTERVAL_SECONDS = 60;
const MIN_INTERVAL_SECONDS = 10;

function intervalSeconds(): number {
  const raw = Number(process.env.NOTIFY_WATCH_INTERVAL_SECONDS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_SECONDS;
  return Math.max(MIN_INTERVAL_SECONDS, Math.round(raw));
}

/** คืน true เมื่อรอบนี้ถือว่าล้มเหลว เพื่อให้โหมดรันครั้งเดียวตั้ง exit code ได้ */
function report(outcome: EvidenceAlertOutcome): boolean {
  const stamp = new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });

  switch (outcome.skippedReason) {
    case "NOTHING_TO_SEND":
      console.log(`[${stamp}] ไม่มีหลักฐานใหม่ที่ต้องแจ้ง`);
      return false;
    case "NOT_CONFIGURED":
      console.error(`[${stamp}] ยังไม่ได้ตั้งค่า Telegram — ดู npm run notify:check`);
      return true;
    case "SEND_FAILED":
      console.error(
        `[${stamp}] ส่งไม่สำเร็จ ${outcome.pending} รายการยังค้างอยู่ จะลองใหม่รอบหน้า: ${outcome.detail ?? ""}`,
      );
      return true;
    default:
      console.log(`[${stamp}] แจ้งเตือนแล้ว ${outcome.notified} รายการ`);
      return false;
  }
}

/**
 * หนึ่งรอบ = รับการกดปุ่มที่ค้างอยู่ แล้วค่อยส่งแจ้งเตือนรายการใหม่
 *
 * รับก่อนส่ง เพื่อให้หลักฐานที่เพิ่งถูกกดยืนยันไปในรอบนี้
 * ไม่ถูกหยิบมาแจ้งซ้ำในขั้นตอนถัดไปของรอบเดียวกัน
 */
async function once(longPollSeconds = 0): Promise<boolean> {
  const inbox = await processTelegramInbox({ longPollSeconds });
  if (inbox.verified > 0 || inbox.rejected > 0) {
    const stamp = new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });
    console.log(
      `[${stamp}] รับคำสั่งจากแชท: ยืนยัน ${inbox.verified} · ตีกลับ ${inbox.rejected}`,
    );
  }
  /*
   * สรุปรายวันอยู่ในรอบเดียวกัน เพราะกันซ้ำด้วยวันที่อยู่แล้ว
   * เรียกทุกรอบก็ส่งวันละครั้ง จึงไม่ต้องตั้งตัวเรียกแยกอีกตัว
   */
  const summary = await runDailySummary();
  if (summary.sent) {
    const stamp = new Date().toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok" });
    console.log(`[${stamp}] ส่งสรุปรายวันของ ${summary.date} แล้ว`);
  }

  return report(await runEvidenceAlerts());
}

async function watch(): Promise<void> {
  const seconds = intervalSeconds();
  console.log(
    `เฝ้าดูอยู่ · รับการกดปุ่มทันที · ตรวจหลักฐานใหม่อย่างน้อยทุก ${Math.min(seconds, 25)} วินาที · กด Ctrl+C เพื่อหยุด`,
  );

  let stopping = false;
  const stop = () => {
    stopping = true;
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  /*
   * ใช้ long polling เพื่อให้ปุ่มตอบสนองเกือบทันที
   *
   * Telegram จะค้างสายไว้จนมีคนกดปุ่มหรือครบเวลา การรอจึงไม่ใช่การนอนเฉย ๆ
   * แต่เป็นการเฝ้าฟังอยู่ ทำให้ไม่ต้องยิงถี่ ๆ และไม่ต้องรอครบรอบถึงจะรู้ว่ามีคนกด
   */
  const longPoll = Math.min(seconds, 25);

  while (!stopping) {
    try {
      await once(longPoll);
    } catch (error) {
      // รอบเดียวล้มต้องไม่ทำให้ตัวเฝ้าดูตาย ไม่งั้นแจ้งเตือนเงียบไปทั้งระบบ
      console.error("รอบนี้ล้มเหลว จะลองใหม่รอบหน้า:", error instanceof Error ? error.message : error);
      if (!stopping) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  console.log("หยุดเฝ้าดูแล้ว");
}

async function main() {
  const isWatch = process.argv.includes("--watch");
  if (isWatch) {
    await watch();
    return;
  }
  if (await once()) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

import "dotenv/config";
import {
  channelEnvName,
  channelLabel,
  channelThreadId,
  isChannelConfigured,
  NOTIFY_CHANNELS,
  sendToChannel,
} from "../src/lib/notify/channels";
import {
  getTelegramChatInfo,
  isTelegramConfigured,
  redactToken,
} from "../src/lib/notify/telegram";

/**
 * ตรวจว่าตั้งค่า Telegram ถูกต้องหรือยัง
 *
 * รันด้วย: npm run notify:check
 *
 * สคริปต์นี้ไม่แตะฐานข้อมูลและไม่ส่งข้อมูลธุรกิจใด ๆ
 * ส่งแค่ข้อความทดสอบเพื่อยืนยันว่าโทเค็นและ chat id ใช้งานได้จริง
 */

function explain(reason: string): string {
  switch (reason) {
    case "NOT_CONFIGURED":
      return [
        "ยังไม่ได้ตั้งค่า ใส่สองค่านี้ในไฟล์ .env แล้วรันใหม่",
        "  TELEGRAM_BOT_TOKEN=   ตามด้วยโทเค็นจาก BotFather แบบเปล่า ๆ ไม่ต้องมีวงเล็บหรือเครื่องหมายคำพูด",
        "  TELEGRAM_CHAT_ID=     ตามด้วย chat id ที่จะให้บอทส่งเข้า (กลุ่มเป็นเลขติดลบ)",
      ].join("\n");
    case "AUTH_FAILED":
      return [
        "Telegram ปฏิเสธโทเค็น ตรวจสามอย่าง",
        "  1. มีวงเล็บ < > ติดมากับค่าหรือไม่ — ใส่โทเค็นเปล่า ๆ ไม่ต้องมีวงเล็บ",
        "  2. คัดลอกมาครบหรือไม่ (รูปแบบคือ ตัวเลข:ตัวอักษรยาว ๆ ไม่มีช่องว่าง)",
        "  3. โทเค็นถูกเพิกถอนไปแล้วหรือไม่ ถ้าใช่ ขอใหม่จาก BotFather ด้วย /token",
      ].join("\n");
    case "TIMEOUT":
      return "ต่อ Telegram ไม่ทันเวลา ตรวจอินเทอร์เน็ตหรือไฟร์วอลล์ แล้วลองใหม่";
    default:
      return [
        "ส่งไม่สำเร็จ สาเหตุที่พบบ่อยคือ chat id ผิด หรือบอทยังไม่ได้อยู่ในกลุ่ม",
        "  ถ้าส่งเข้ากลุ่ม ต้องเชิญบอทเข้ากลุ่มก่อน และอย่าเตะออกภายหลัง",
        "  ถ้ากลุ่มถูกอัปเกรดเป็น supergroup เลข chat id จะเปลี่ยน ต้องหาใหม่",
        "  วิธีหา chat id: กด Start แล้วทักบอทของคุณหนึ่งข้อความก่อน",
        "  แล้วเปิด https://api.telegram.org/botTOKEN/getUpdates ในเบราว์เซอร์",
        "  โดยแทน TOKEN ด้วยโทเค็นจริงแบบต่อติดกัน ห้ามใส่วงเล็บ < >",
        "  มองหา chat.id ในผลลัพธ์ (กลุ่มจะเป็นเลขติดลบ ต้องเอาเครื่องหมายลบมาด้วย)",
        "  ถ้าได้ result ว่าง แปลว่ายังไม่เคยทักบอท หรือทักก่อนเปลี่ยนโทเค็น",
        "  ในกลุ่มต้องพิมพ์ /start เพราะ privacy mode ทำให้บอทไม่เห็นข้อความธรรมดา",
      ].join("\n");
  }
}

async function main() {
  if (!isTelegramConfigured()) {
    console.error("✗ ยังไม่ได้ตั้งค่า\n");
    console.error(explain("NOT_CONFIGURED"));
    process.exitCode = 1;
    return;
  }

  // ยืนยันปลายทางก่อนส่ง จะได้รู้ว่าไม่ได้ตั้ง chat id ผิดที่
  const info = await getTelegramChatInfo();
  if (info.ok) {
    const label =
      info.chat.type === "private"
        ? "แชทส่วนตัว"
        : info.chat.type === "channel"
          ? "ช่อง"
          : "กลุ่ม";
    console.log(`ปลายทาง: ${label} "${info.chat.title}" (id ${info.chat.id})`);
    if (info.chat.type === "private") {
      console.log("  หมายเหตุ: นี่คือแชทส่วนตัว ถ้าตั้งใจจะส่งเข้ากลุ่ม ต้องเปลี่ยน TELEGRAM_CHAT_ID");
    }
  } else {
    console.warn(`อ่านข้อมูลแชทไม่ได้ (${info.reason}) แต่จะลองส่งต่อไป`);
  }

  const stamp = new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" });
  let failed = false;

  for (const channel of NOTIFY_CHANNELS) {
    const label = channelLabel(channel);
    const threadId = channelThreadId(channel);

    if (!isChannelConfigured(channel)) {
      console.log(
        `• ห้อง "${label}" ยังไม่ได้ตั้ง ${channelEnvName(channel)} — จะส่งเข้าห้องรวมของกลุ่มแทน`,
      );
    }

    const result = await sendToChannel(
      channel,
      `ทดสอบห้อง "${label}"
เวลา ${stamp}

ถ้าข้อความนี้อยู่ถูกห้อง แปลว่าตั้งค่าเรียบร้อย`,
    );

    if (result.ok) {
      console.log(`✓ ส่งเข้าห้อง "${label}" สำเร็จ${threadId ? ` (topic ${threadId})` : ""}`);
      continue;
    }

    failed = true;
    console.error(`✗ ส่งเข้าห้อง "${label}" ไม่สำเร็จ (${result.reason})`);
    console.error(`  ${redactToken(result.detail)}`);
    if (/thread not found|TOPIC_DELETED|message thread/i.test(result.detail)) {
      console.error(
        `  เลข topic ใน ${channelEnvName(channel)} ไม่ตรงกับห้องที่มีอยู่ ให้หาใหม่จาก getUpdates`,
      );
    }
  }

  if (failed) {
    console.error("");
    console.error(explain("REQUEST_FAILED"));
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("เรียบร้อย ไปดูข้อความในแต่ละห้องได้เลย");
}

main().catch((error) => {
  console.error(redactToken(error instanceof Error ? error.message : String(error)));
  process.exit(1);
});

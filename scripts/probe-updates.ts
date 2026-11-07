import "dotenv/config";
import { fetchTelegramUpdates } from "../src/lib/notify/telegram";

async function main() {
  // ไม่ส่ง offset = อ่านอย่างเดียว ไม่ยืนยัน จึงไม่ทำให้ของหาย
  const updates = await fetchTelegramUpdates();
  console.log(`พบ ${updates.length} เหตุการณ์ค้างอยู่`);
  for (const u of updates) {
    const cb = u.callback_query;
    const msg = u.message;
    console.log(
      JSON.stringify({
        update_id: u.update_id,
        kind: cb ? "callback_query" : msg ? "message" : "other",
        from: cb?.from?.id ?? msg?.from?.id,
        data: cb?.data,
        text: msg?.text?.slice(0, 40),
        isReply: Boolean(msg?.reply_to_message),
      }),
    );
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

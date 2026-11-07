import { sendTelegramMessage, type TelegramSendResult } from "./telegram";

/**
 * ห้องปลายทางของการแจ้งเตือน
 *
 * กลุ่มเดียวแต่แยกห้องด้วย Telegram Topics เพราะงานสองอย่างนี้คนละจังหวะกัน
 * สรุปรายวันมาวันละครั้งและอ่านย้อนหลังได้สบาย ส่วนหลักฐานเข้ามาเรื่อย ๆ
 * ถ้าปนกันห้องเดียว สรุปรายวันจะจมอยู่ใต้สลิปจนหาไม่เจอ
 *
 * ผู้เรียกระบุเป็นชื่อห้องเชิงความหมาย ไม่ใช่เลข thread
 * การเปลี่ยนว่าห้องไหนอยู่ที่ไหนจึงแก้ที่ environment จุดเดียว ไม่ต้องแตะโค้ดงาน
 */

export const NOTIFY_CHANNELS = ["daily-summary", "evidence"] as const;
export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number];

const ENV_BY_CHANNEL: Record<NotifyChannel, string> = {
  "daily-summary": "TELEGRAM_TOPIC_DAILY_SUMMARY",
  evidence: "TELEGRAM_TOPIC_EVIDENCE",
};

const LABEL_BY_CHANNEL: Record<NotifyChannel, string> = {
  "daily-summary": "สรุปรายวัน",
  evidence: "ตรวจหลักฐานและสลิป",
};

export function channelLabel(channel: NotifyChannel): string {
  return LABEL_BY_CHANNEL[channel];
}

export function channelEnvName(channel: NotifyChannel): string {
  return ENV_BY_CHANNEL[channel];
}

/**
 * เลข Topic ของห้องนั้น
 *
 * คืน undefined เมื่อยังไม่ได้ตั้งค่า ซึ่งแปลว่าส่งเข้าห้องรวมของกลุ่ม
 * จงใจให้ทำงานต่อได้โดยไม่ต้องตั้งครบ เพราะกลุ่มที่ยังไม่เปิด Topics ก็ควรใช้งานได้
 */
export function channelThreadId(channel: NotifyChannel): string | undefined {
  const raw = process.env[ENV_BY_CHANNEL[channel]]?.trim();
  if (!raw) return undefined;
  // เลข thread ต้องเป็นจำนวนเต็มบวก ค่าที่พิมพ์ผิดถือว่าไม่ได้ตั้ง ดีกว่าส่งพลาดห้อง
  return /^\d+$/.test(raw) ? raw : undefined;
}

export function isChannelConfigured(channel: NotifyChannel): boolean {
  return channelThreadId(channel) !== undefined;
}

export function sendToChannel(
  channel: NotifyChannel,
  text: string,
): Promise<TelegramSendResult> {
  return sendTelegramMessage(text, { threadId: channelThreadId(channel) });
}

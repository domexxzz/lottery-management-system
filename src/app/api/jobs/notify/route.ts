import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runDailySummary } from "@/lib/notify/daily-summary";
import { runEvidenceAlerts } from "@/lib/notify/evidence-alerts";

export const dynamic = "force-dynamic";

/** เทียบแบบเวลาคงที่ เพื่อไม่ให้เดา token ทีละตัวอักษรจากเวลาตอบกลับได้ */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Endpoint สำหรับ scheduler เรียกส่งแจ้งเตือนหลักฐานที่รอตรวจ
 *
 * ใช้ token แยกจาก cutoff job เพราะเป็นคนละอำนาจ
 * ผู้ที่ตั้ง scheduler แจ้งเตือนไม่ควรปิดรอบรับบิลได้ไปด้วย
 *
 * งานเป็น idempotent: รายการที่แจ้งไปแล้วมีแถว Audit กำกับ จะไม่ถูกหยิบซ้ำ
 * เรียกถี่แค่ไหนก็ไม่ทำให้ข้อความซ้ำ
 */
export async function POST(request: NextRequest) {
  const expected = process.env.NOTIFY_JOB_TOKEN;

  if (!expected) {
    // ไม่ตั้ง token = ปิดการใช้งาน ดีกว่าเปิดทิ้งไว้โดยไม่มีการป้องกัน
    return NextResponse.json({ error: "job ไม่ได้เปิดใช้งาน" }, { status: 503 });
  }

  const provided = request.headers.get("x-job-token") ?? "";
  if (!tokenMatches(provided, expected)) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  /*
   * ทำทั้งสองงานในการเรียกครั้งเดียว
   *
   * สรุปรายวันกันซ้ำด้วยวันที่อยู่แล้ว เรียกถี่แค่ไหนก็ส่งวันละครั้ง
   * จึงไม่ต้องตั้ง scheduler แยกให้ต้องดูแลสองที่
   */
  const [evidence, dailySummary] = await Promise.all([runEvidenceAlerts(), runDailySummary()]);
  return NextResponse.json({ evidence, dailySummary });
}

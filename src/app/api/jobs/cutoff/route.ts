import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { lockDueDraws } from "@/lib/draws/service";

export const dynamic = "force-dynamic";

/** เทียบแบบเวลาคงที่ เพื่อไม่ให้เดา token ทีละตัวอักษรจากเวลาตอบกลับได้ */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Endpoint สำหรับ scheduler เรียกปิดรอบที่ถึงเวลา Cutoff
 *
 * ป้องกันด้วย header x-job-token ไม่ใช้ session เพราะผู้เรียกเป็นเครื่อง
 * ไม่ใช่คน ตั้งค่า CUTOFF_JOB_TOKEN ใน environment
 *
 * ตัวงานเองเป็น idempotent: รอบที่ปิดไปแล้วจะไม่ถูกเลือกซ้ำ
 * เรียกถี่เกินไปจึงไม่เป็นอันตราย
 */
export async function POST(request: NextRequest) {
  const expected = process.env.CUTOFF_JOB_TOKEN;

  if (!expected) {
    // ไม่ตั้ง token = ปิดการใช้งาน ดีกว่าเปิดทิ้งไว้โดยไม่มีการป้องกัน
    return NextResponse.json({ error: "job ไม่ได้เปิดใช้งาน" }, { status: 503 });
  }

  const provided = request.headers.get("x-job-token") ?? "";
  if (!tokenMatches(provided, expected)) {
    return NextResponse.json({ error: "ไม่ได้รับอนุญาต" }, { status: 401 });
  }

  const result = await lockDueDraws();

  return NextResponse.json({
    lockedCount: result.locked.length,
    locked: result.locked,
    failed: result.failed,
  });
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Health check สำหรับ load balancer และ monitoring (LOT-35, LOT-41) */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // time: เวลา Server (ms) ให้หน้าสร้างบิลเทียบนาฬิกามือถือ นับถอยหลังปิดรับตามเวลาจริงของ Server
    return NextResponse.json({ status: "ok", database: "up", time: Date.now() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // ไม่ส่งรายละเอียด error ออกไป เพื่อไม่ให้รั่วข้อมูลโครงสร้างภายใน
    return NextResponse.json({ status: "degraded", database: "down", time: Date.now() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

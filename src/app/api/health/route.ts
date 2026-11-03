import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Health check สำหรับ load balancer และ monitoring (LOT-35, LOT-41) */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "up" });
  } catch {
    // ไม่ส่งรายละเอียด error ออกไป เพื่อไม่ให้รั่วข้อมูลโครงสร้างภายใน
    return NextResponse.json({ status: "degraded", database: "down" }, { status: 503 });
  }
}

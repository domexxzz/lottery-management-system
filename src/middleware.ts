import { NextResponse, type NextRequest } from "next/server";
import { REQUEST_ID_HEADER, isUsableRequestId } from "@/lib/requestId";

/**
 * ให้ทุก request มี request_id (LOT-38)
 *
 * ถ้า reverse proxy หรือ load balancer ส่ง x-request-id มาแล้ว ให้ใช้ค่านั้นต่อ
 * เพื่อให้ตาม chain ข้ามระบบได้ ถ้าไม่มีจึงสร้างใหม่
 *
 * ค่านี้ถูกส่งต่อสองทาง:
 *   1. แนบกลับใน response header ให้ผู้ใช้อ้างอิงได้เวลาแจ้งปัญหา
 *   2. แนบใน request header ให้ server component และ server action
 *      อ่านผ่าน headers() แล้วเขียนลง AuditEvent.requestId
 */
export function middleware(request: NextRequest) {
  const incoming = request.headers.get(REQUEST_ID_HEADER);
  const requestId = isUsableRequestId(incoming) ? incoming : crypto.randomUUID();

  const headers = new Headers(request.headers);
  headers.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  // ข้ามไฟล์ static และ image optimizer เพราะไม่ใช่ request ที่ต้องตามรอย
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

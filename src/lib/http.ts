import { AppError, ForbiddenError } from "@/lib/errors";

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) throw new ForbiddenError("ไม่สามารถยืนยันต้นทางของคำขอได้");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new ForbiddenError("ต้นทางของคำขอไม่ถูกต้อง");
  }
  if (originHost !== host) throw new ForbiddenError("ปฏิเสธคำขอจากเว็บไซต์อื่น");
}

export function apiError(error: unknown): Response {
  if (error instanceof AppError) {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status });
  }
  console.error("Unhandled API error", error);
  return Response.json(
    { error: { code: "INTERNAL_ERROR", message: "ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่" } },
    { status: 500 },
  );
}

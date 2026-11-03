/**
 * Structured logging (LOT-38)
 *
 * พ่น log เป็น JSON บรรทัดเดียวต่อเหตุการณ์ เพื่อให้ระบบรวบรวม log
 * แยก field ได้โดยไม่ต้องใช้ regex และค้นด้วย request_id ได้ตรง ๆ
 *
 * ห้าม log ข้อมูลอ่อนไหว: รหัสผ่าน session token หรือค่า hash ใด ๆ
 * ชื่อ login ถือว่า log ได้เพราะจำเป็นต่อการสืบหาเหตุการณ์
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = {
  requestId?: string | undefined;
  userId?: string | undefined;
  organizationId?: string | undefined;
  entityType?: string | undefined;
  entityId?: string | undefined;
  durationMs?: number | undefined;
  [key: string]: unknown;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minimumLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL;
  if (configured === "debug" || configured === "info" || configured === "warn" || configured === "error") {
    return configured;
  }
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

function write(level: LogLevel, message: string, fields: LogFields = {}): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minimumLevel()]) return;

  const entry = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
  };

  const line = JSON.stringify(entry);
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug: (message: string, fields?: LogFields) => write("debug", message, fields),
  info: (message: string, fields?: LogFields) => write("info", message, fields),
  warn: (message: string, fields?: LogFields) => write("warn", message, fields),
  error: (message: string, fields?: LogFields) => write("error", message, fields),
};

/** แปลง error เป็น field ที่ปลอดภัยต่อการ log — ไม่พ่น stack ใน production */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      ...(process.env.NODE_ENV !== "production" && { stack: error.stack }),
    };
  }
  return { errorMessage: String(error) };
}

import { hash, verify } from "@node-rs/argon2";

/** พารามิเตอร์ตามคำแนะนำ OWASP สำหรับ Argon2id */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

const MIN_PASSWORD_LENGTH = 10;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    // hash เสียรูปหรือ algorithm ไม่ตรง — ถือว่าไม่ผ่าน ไม่โยน error ออกไป
    return false;
  }
}

export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    return `รหัสผ่านต้องยาวอย่างน้อย ${MIN_PASSWORD_LENGTH} ตัวอักษร`;
  }
  if (!/[a-zA-Z]/.test(plain) || !/[0-9]/.test(plain)) {
    return "รหัสผ่านต้องมีทั้งตัวอักษรและตัวเลข";
  }
  return null;
}

/**
 * ชื่อผู้ใช้และรหัส Agent อัตโนมัติ: A1, A2, A3, …
 *
 * ทั้งสองใช้เลขเดียวกันเพื่อให้จำง่าย (ชื่อผู้ใช้ A7 = รหัส Agent A7)
 * นับต่อจากเลขที่สูงที่สุดในชื่อผู้ใช้และรหัส Agent รวมบัญชีที่ถูกซ่อน (มีประวัติ)
 * เลขของบัญชีที่มีบิลจึงไม่ถูกนำกลับมาใช้ บิลเก่าไม่ปนกับบัญชีใหม่
 * ส่วนบัญชีที่ลบจริง (ไม่เคยใช้งาน) ไม่มีอะไรอ้างถึง เลขนั้นจึงใช้ใหม่ได้
 *
 * ชื่อผู้ใช้เก็บเป็นตัวพิมพ์เล็ก (a7) ตามกติกาของระบบ หน้าจอแสดงเป็น A7 และพิมพ์แบบไหนก็เข้าสู่ระบบได้
 */
const AGENT_LOGIN = /^a(\d{1,9})$/;
const AGENT_CODE = /^A0*(\d{1,9})$/;

export function agentIdentityAfter(logins: readonly string[], codes: readonly string[]): { login: string; code: string } {
  let max = 0;
  for (const login of logins) {
    const match = AGENT_LOGIN.exec(login.toLowerCase());
    if (match) max = Math.max(max, Number(match[1]));
  }
  for (const code of codes) {
    const match = AGENT_CODE.exec(code.toUpperCase());
    if (match) max = Math.max(max, Number(match[1]));
  }
  const next = max + 1;
  return { login: `a${next}`, code: `A${next}` };
}

/** ชื่อผู้ใช้สำหรับแสดงผล: บัญชี Agent อัตโนมัติแสดงเป็นตัวพิมพ์ใหญ่ เช่น A7 */
export function displayLogin(login: string): string {
  return AGENT_LOGIN.test(login) ? login.toUpperCase() : login;
}

/** รหัสผ่านที่ Owner ตั้งให้: ไม่มีข้อกำหนดเรื่องความยาวหรือชนิดตัวอักษร ขอแค่ไม่ว่าง */
export function validateOwnerSetPassword(password: string): string | null {
  if (password.length === 0) return "กรุณากรอกรหัสผ่าน";
  if (password.length > 256) return "รหัสผ่านยาวเกิน 256 ตัวอักษร";
  return null;
}

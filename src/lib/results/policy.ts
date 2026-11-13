import type { Role, ResultStatus } from "@prisma/client";

/** Owner และ Admin บันทึกพร้อมยืนยันผลใน Action เดียว */
export function shouldApproveResultOnEntry(role: Role): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Owner แก้ผลที่ประกาศแล้วได้ทันที โดยไม่ต้องรอผู้ตรวจคนที่สอง */
export function shouldApproveCorrectionOnProposal(role: Role): boolean {
  return role === "OWNER";
}

/**
 * การแก้ผลที่ประกาศไปแล้ว ต่างจากการกรอกผลครั้งแรก
 *
 * การกรอกครั้งแรกจบในขั้นตอนเดียวเพราะยังไม่มีใครอ้างอิงตัวเลขนั้น
 * แต่เมื่อผลถูกอนุมัติแล้ว ตัวเลขนั้นถูกใช้คำนวณเงินและอาจจ่ายออกไปแล้ว
 * Admin จึงเสนอให้ Owner อนุมัติ ส่วน Owner แก้แล้วมีผลทันทีตามสิทธิ์สูงสุด
 *
 * ผลเดิมไม่ถูกลบหรือเขียนทับ แต่ถูกแทนที่ด้วย version ถัดไป
 * เพื่อให้ย้อนดูได้ว่าเคยประกาศอะไรไว้ก่อนหน้า
 */
export function isCorrection(previousStatus: ResultStatus | null): boolean {
  return previousStatus === "APPROVED";
}

/** รอบที่ปิดบัญชีแล้วแก้ผลไม่ได้ ต้องเปิดรอบใหม่หรือแก้นอกระบบพร้อมบันทึกเหตุผล */
export function canCorrectInDrawStatus(drawStatus: string): boolean {
  return drawStatus !== "CLOSED";
}

/**
 * ผลที่แก้ใหม่ได้รับอนุมัติแล้ว ตัวเลขการเงินที่คำนวณไว้ก่อนหน้าใช้ไม่ได้อีก
 *
 * true = ต้องล้างสถานะการตรวจสอบยอดและคำนวณใหม่ทั้งรอบ
 * ปล่อยให้ยอดที่ตรวจสอบแล้วค้างอยู่บนผลเก่าคือการโกหกผู้อนุมัติคนถัดไป
 */
export function correctionInvalidatesSettlement(drawStatus: string): boolean {
  return drawStatus === "SETTLED";
}

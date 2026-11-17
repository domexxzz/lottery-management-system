/** ข้อผิดพลาดที่ตั้งใจส่งถึงผู้ใช้ ข้อความต้องไม่เปิดเผยข้อมูลภายใน */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "กรุณาเข้าสู่ระบบ") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "ไม่มีสิทธิ์ดำเนินการนี้") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "ไม่พบข้อมูล") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, "VALIDATION_FAILED");
  }
}

/** ละเมิดกฎ state machine เช่น ยืนยันบิลที่ยืนยันไปแล้ว */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

/** เลขในบิลที่ Server ปฏิเสธตอนยืนยัน ระบุเป็นประเภท + เลข ให้หน้าสร้างบิลชี้ได้ว่าต้องแก้รายการไหน */
export type RejectedBillItem = { prizeTypeId: string; number: string; reason: string };

/**
 * ตรวจบิลไม่ผ่านเพราะบางรายการ เช่นเลขเต็มระหว่างที่ผู้ใช้กำลังกรอก
 * เป็น ValidationError เหมือนเดิม ที่เรียกใช้เดิมจึงทำงานได้ตามปกติ
 */
export class BillItemsRejectedError extends ValidationError {
  constructor(message: string, readonly rejected: RejectedBillItem[]) {
    super(message);
  }
}

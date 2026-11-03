/**
 * ตัวช่วยสร้าง CSV ที่เปิดใน Excel แล้วภาษาไทยไม่เพี้ยน
 *
 * ใช้ร่วมกันทั้งไฟล์กระทบยอดและรายงานทุกตัว เพื่อให้กฎการ escape
 * และการกัน formula injection อยู่ที่เดียว
 */

/**
 * ครอบค่าให้ปลอดภัยสำหรับ CSV
 *
 * ค่าที่ขึ้นต้นด้วย = + - @ หรือ tab จะถูก Excel ตีความเป็นสูตร
 * ซึ่งเป็นช่องทาง formula injection ถ้าค่านั้นมาจากผู้ใช้ เช่นชื่อบิล
 * จึงเติม single quote นำหน้าเพื่อบังคับให้เป็นข้อความ
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function csvRow(cells: readonly string[]): string {
  return cells.map(csvCell).join(",");
}

/** ประกอบเป็นไฟล์ CSV พร้อม BOM ให้ Excel อ่าน UTF-8 ถูกต้อง */
export function csvFile(header: readonly string[], rows: readonly (readonly string[])[]): string {
  const lines = [csvRow(header), ...rows.map(csvRow)];
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** header สำหรับตอบกลับเป็นไฟล์ดาวน์โหลด */
export function csvHeaders(filename: string): Record<string, string> {
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  };
}

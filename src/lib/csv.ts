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
  // จำนวนเงินติดลบจากระบบต้องยังเป็นตัวเลข เพื่อให้ Excel SUM/Sort ได้
  // แต่ข้อความผู้ใช้ที่ขึ้นต้นด้วยเครื่องหมายสูตรยังต้องถูกกันไว้
  const negativeNumber = /^-\d+(?:\.\d+)?$/.test(value);
  const guarded = !negativeNumber && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
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

const BANGKOK_DATE_TIME = new Intl.DateTimeFormat("th-TH", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Bangkok",
});

/** วันที่เวลาไทยรูปแบบสั้น อ่านง่ายและไม่แสดง ISO/UTC ให้ผู้ใช้ทั่วไป */
export function csvDateTime(value: Date): string {
  return BANGKOK_DATE_TIME.format(value).replace(",", "");
}

/** ทำส่วนชื่อไฟล์ให้ปลอดภัยกับ Windows โดยยังคงภาษาไทยไว้ */
export function csvFilenamePart(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "_");
}

/** header สำหรับตอบกลับเป็นไฟล์ดาวน์โหลด */
export function csvHeaders(filename: string): Record<string, string> {
  const safeFilename = csvFilenamePart(filename) || "export.csv";
  const fallback = safeFilename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "export.csv";
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
    "Cache-Control": "no-store",
  };
}

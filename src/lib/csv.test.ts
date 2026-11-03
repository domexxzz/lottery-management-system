import { describe, expect, test } from "vitest";
import { csvCell, csvFile, csvRow } from "./csv";

describe("csvCell", () => {
  test("ครอบด้วยเครื่องหมายคำพูดเสมอ", () => {
    expect(csvCell("abc")).toBe('"abc"');
  });

  test("escape เครื่องหมายคำพูดในค่า", () => {
    expect(csvCell('เขา"พูด"ว่า')).toBe('"เขา""พูด""ว่า"');
  });

  test("ค่าที่มีจุลภาคไม่ทำให้คอลัมน์เพี้ยน", () => {
    expect(csvCell("ก, ข")).toBe('"ก, ข"');
  });

  test.each(["=1+1", "+1", "-1", "@SUM(A1)"])("กัน formula injection: %s", (value) => {
    expect(csvCell(value)).toBe(`"'${value}"`);
  });

  test("ค่าปกติที่มีเครื่องหมายลบอยู่กลางไม่ถูกเติม quote นำหน้า", () => {
    expect(csvCell("A-001")).toBe('"A-001"');
  });

  test("ยอดเงินติดลบถูกมองเป็นสูตร จึงถูกบังคับเป็นข้อความ", () => {
    // ยอมรับผลข้างเคียงนี้ เพราะความปลอดภัยสำคัญกว่าการที่ Excel
    // มองยอดติดลบเป็นตัวเลขอัตโนมัติ
    expect(csvCell("-92897.00")).toBe('"\'-92897.00"');
  });
});

describe("csvRow", () => {
  test("ต่อเซลล์ด้วยจุลภาค", () => {
    expect(csvRow(["a", "b"])).toBe('"a","b"');
  });
});

describe("csvFile", () => {
  test("ขึ้นต้นด้วย BOM และใช้ CRLF", () => {
    const file = csvFile(["ชื่อ"], [["ก"]]);
    expect(file.startsWith("﻿")).toBe(true);
    expect(file).toBe('﻿"ชื่อ"\r\n"ก"\r\n');
  });

  test("ไม่มีแถวข้อมูลก็ยังมี header", () => {
    expect(csvFile(["ชื่อ"], [])).toBe('﻿"ชื่อ"\r\n');
  });
});

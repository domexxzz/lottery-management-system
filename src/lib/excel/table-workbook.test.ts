import { describe, expect, test } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { generateTableWorkbook, xlsxHeaders } from "./table-workbook";

describe("Excel ตารางดาวน์โหลด", () => {
  test("มีความกว้างคอลัมน์ หัวตารางค้าง ตัวกรอง และ typed cells", () => {
    const bytes = generateTableWorkbook({
      title: "สรุปบัญชี",
      subtitle: "งวด 18 พฤศจิกายน 2569",
      columns: [
        { header: "Agent", type: "text" },
        { header: "จำนวนบิล", type: "integer" },
        { header: "ยอดขาย (บาท)", type: "money" },
        { header: "อัตราค่าคอม", type: "percentage" },
        { header: "วันที่", type: "datetime" },
      ],
      rows: [["A001", 2, 1430, 0.3, new Date("2026-11-18T13:40:00+07:00")]],
    });
    const files = unzipSync(bytes);
    const summary = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    const sheet = strFromU8(files["xl/worksheets/sheet2.xml"]!);
    expect(summary).toContain("ยอดสรุป");
    expect(strFromU8(files["xl/workbook.xml"]!)).toContain('name="Summary"');
    expect(sheet).toContain('<pane ySplit="4"');
    expect(sheet).toContain('<autoFilter ref="A4:E5"/>');
    expect(sheet).toContain('<col min="1" max="1"');
    expect(sheet).toContain('<c r="C5" s="3"><v>1430</v></c>');
    expect(sheet).toContain('<c r="D5" s="5"><v>0.3</v></c>');
    expect(sheet).toContain('<c r="E5" s="7"><v>');
    expect(strFromU8(files["xl/styles.xml"]!)).toContain("yyyy-mm-dd hh:mm");
  });

  test("ส่งชื่อไฟล์ภาษาไทยแบบมาตรฐานและมี fallback", () => {
    const headers = xlsxHeaders("สรุปบัญชี_18/11/2569.xlsx");
    expect(headers["Content-Type"]).toContain("spreadsheetml");
    expect(headers["Content-Disposition"]).toContain("filename*=UTF-8''");
    expect(headers["Content-Disposition"]).not.toContain("18/11");
  });
});

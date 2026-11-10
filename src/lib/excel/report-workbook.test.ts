import { describe, expect, test } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { generateReportWorkbook } from "./report-workbook";

describe("Excel รายละเอียดรายงาน", () => {
  test("สร้างไฟล์ xlsx ที่มีตัวเลขและวันที่เป็น typed cells", () => {
    const bytes = generateReportWorkbook({
      title: "ภาพรวมยอดขาย",
      periodLabel: "งวดนี้",
      groupLabel: "รายงวด",
      rows: [{ date: new Date(2026, 10, 16), code: "16 พ.ย. 2569", name: "งวด 16 พฤศจิกายน 2569", gross: 1000, payout: 500, commission: 300, net: 200, bills: 2, items: 4, winners: 1 }],
    });
    const files = unzipSync(bytes);
    expect(files["xl/workbook.xml"]).toBeDefined();
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    expect(sheet).toContain("ภาพรวมยอดขาย");
    expect(sheet).toContain('<c r="D5" s="3"><v>1000</v></c>');
    expect(sheet).toContain('<c r="A5" s="4"><v>');
    expect(sheet).toContain('<autoFilter ref="A4:J5"/>');
    expect(sheet.indexOf("<autoFilter")).toBeLessThan(sheet.indexOf("<mergeCells"));
  });
});

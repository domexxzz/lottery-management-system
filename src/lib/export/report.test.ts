import { describe, expect, test } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { createReportDownload, generateReportCsv, reportDate, type ReportExportInput } from "./report";

const report: ReportExportInput = {
  filename: "account-summary_2026-11-01_2026-11-30",
  title: "สรุปบัญชี",
  sheetName: "Details",
  metadata: [{ label: "ช่วงข้อมูล", value: "2026-11-01 ถึง 2026-11-30" }],
  summary: [{ label: "ยอดขายรวม", value: 90, type: "money", unit: "บาท" }],
  columns: [
    { header: "วันที่", type: "date" }, { header: "รายการ", type: "text" },
    { header: "ยอดขาย", type: "money" }, { header: "กำไร/ขาดทุน", type: "money" },
  ],
  rows: [[new Date("2026-11-19T10:00:00+07:00"), '=HYPERLINK("bad")', 100, -10]],
  generatedAt: new Date("2026-11-19T12:00:00+07:00"),
};

describe("ระบบส่งออกรายงานกลาง", () => {
  test("CSV ใช้ BOM, CRLF, วันที่มาตรฐาน, ตัวเลขสะอาด และกัน formula injection", () => {
    const csv = generateReportCsv(report);
    expect(csv).toBe('﻿"วันที่","รายการ","ยอดขาย","กำไร/ขาดทุน"\r\n"2026-11-19","\'=HYPERLINK(""bad"")","100.00","-10.00"\r\n');
    expect(csv).not.toContain("ยอดขายรวม");
  });

  test("Excel มี Summary และ Details พร้อม filter/freeze และยอดเงินเป็นตัวเลข", () => {
    const output = createReportDownload(report, "xlsx");
    expect(output.body).toBeInstanceOf(ArrayBuffer);
    const files = unzipSync(new Uint8Array(output.body as ArrayBuffer));
    const workbook = strFromU8(files["xl/workbook.xml"]!);
    const summary = strFromU8(files["xl/worksheets/sheet1.xml"]!);
    const details = strFromU8(files["xl/worksheets/sheet2.xml"]!);
    expect(workbook).toContain('name="Summary"');
    expect(workbook).toContain('name="Details"');
    expect(summary).toContain("ยอดขายรวม");
    expect(details).toContain('<pane ySplit="4"');
    expect(details).toContain('<autoFilter ref="A4:D5"/>');
    expect(details).toContain('<c r="C5" s="3"><v>100</v></c>');
    expect(details).toContain('<c r="D5" s="3"><v>-10</v></c>');
  });

  test("วันที่และเวลารายงานเป็นเวลาประเทศไทยแบบไม่กำกวม", () => {
    expect(reportDate(new Date("2026-11-19T03:04:05Z"), true)).toBe("2026-11-19 10:04:05");
  });
});

import { strToU8, zipSync } from "fflate";

export type ReportWorkbookRow = {
  date: Date | null;
  code: string;
  name: string;
  gross: number;
  payout: number;
  commission: number;
  net: number;
  bills: number;
  items: number;
  winners: number;
};

export type ReportWorkbookInput = {
  title: string;
  periodLabel: string;
  groupLabel: string;
  rows: ReportWorkbookRow[];
};

const HEADER = ["วันที่", "รหัส", "รายการ", "ยอดขาย (บาท)", "จ่ายรางวัล (บาท)", "คอมมิชชัน (บาท)", "ยอดสุทธิ (บาท)", "จำนวนบิล", "จำนวนรายการ", "รายการถูกรางวัล"] as const;

function xml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function columnName(index: number): string {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + value % 26) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

function excelDate(value: Date): number {
  return (Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

function cell(ref: string, value: string | number | Date | null, style = 0): string {
  if (value === null || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (value instanceof Date) return `<c r="${ref}" s="4"><v>${excelDate(value)}</v></c>`;
  if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function sheetXml(input: ReportWorkbookInput): string {
  const title = `<row r="1" ht="26" customHeight="1">${cell("A1", input.title, 1)}</row>`;
  const meta = `<row r="2">${cell("A2", `ช่วงข้อมูล: ${input.periodLabel}`, 6)}${cell("F2", `กลุ่มข้อมูล: ${input.groupLabel}`, 6)}</row>`;
  const header = `<row r="4" ht="24" customHeight="1">${HEADER.map((value, index) => cell(`${columnName(index)}4`, value, 2)).join("")}</row>`;
  const detail = input.rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 5;
    const values: (string | number | Date | null)[] = [row.date, row.code, row.name, row.gross, row.payout, row.commission, row.net, row.bills, row.items, row.winners];
    return `<row r="${rowNumber}">${values.map((value, columnIndex) => cell(`${columnName(columnIndex)}${rowNumber}`, value, columnIndex >= 3 && columnIndex <= 6 ? 3 : columnIndex >= 7 ? 5 : 0)).join("")}</row>`;
  }).join("");
  const lastRow = Math.max(4, input.rows.length + 4);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="2" width="14" customWidth="1"/><col min="3" max="3" width="30" customWidth="1"/><col min="4" max="7" width="18" customWidth="1"/><col min="8" max="10" width="15" customWidth="1"/></cols>
  <sheetData>${title}${meta}${header}${detail}</sheetData>
  <autoFilter ref="A4:J${lastRow}"/>
  <mergeCells count="2"><mergeCell ref="A1:J1"/><mergeCell ref="A2:E2"/></mergeCells>
</worksheet>`;
}

/** สร้างไฟล์ XLSX จริง โดยเก็บตัวเลขและวันที่เป็น typed cells สำหรับนำไปคำนวณต่อใน Excel */
export function generateReportWorkbook(input: ReportWorkbookInput): Uint8Array {
  const now = new Date().toISOString();
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(input.title)}</dc:title><dc:creator>Lottery Management System</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Lottery Management System</Application></Properties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="รายละเอียดรายงาน" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="3"><font><sz val="11"/><name val="Aptos"/></font><font><b/><sz val="16"/><color rgb="FF123C68"/><name val="Aptos Display"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1677FF"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD8E6F5"/></left><right style="thin"><color rgb="FFD8E6F5"/></right><top style="thin"><color rgb="FFD8E6F5"/></top><bottom style="thin"><color rgb="FFD8E6F5"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
    "xl/worksheets/sheet1.xml": strToU8(sheetXml(input)),
  };
  return zipSync(files, { level: 6 });
}

export function downloadReportWorkbook(input: ReportWorkbookInput, fileName: string): void {
  const bytes = generateReportWorkbook(input);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

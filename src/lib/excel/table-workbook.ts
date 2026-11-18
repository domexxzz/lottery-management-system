import { strToU8, zipSync } from "fflate";
import { csvFilenamePart } from "@/lib/csv";

export type TableWorkbookCell = string | number | Date | null;
export type TableWorkbookColumnType = "text" | "integer" | "money" | "decimal" | "percentage" | "date" | "datetime";

export type TableWorkbookColumn = {
  header: string;
  type?: TableWorkbookColumnType;
  width?: number;
};

export type TableWorkbookInput = {
  title: string;
  subtitle?: string;
  sheetName?: string;
  columns: readonly TableWorkbookColumn[];
  rows: readonly (readonly TableWorkbookCell[])[];
};

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

function bangkokParts(value: Date): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

function excelDate(value: Date): number {
  const part = bangkokParts(value);
  return (Date.UTC(part.year!, part.month! - 1, part.day!, part.hour!, part.minute!, part.second!) - Date.UTC(1899, 11, 30)) / 86_400_000;
}

const STYLE_BY_TYPE: Record<TableWorkbookColumnType, number> = {
  text: 0,
  money: 3,
  integer: 4,
  percentage: 5,
  date: 6,
  datetime: 7,
  decimal: 8,
};

function cell(ref: string, value: TableWorkbookCell, style: number): string {
  if (value === null || value === "") return `<c r="${ref}" s="${style}"/>`;
  if (value instanceof Date) return `<c r="${ref}" s="${style}"><v>${excelDate(value)}</v></c>`;
  if (typeof value === "number") return `<c r="${ref}" s="${style}"><v>${Number.isFinite(value) ? value : 0}</v></c>`;
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}

function displayLength(value: TableWorkbookCell): number {
  if (value === null) return 0;
  if (value instanceof Date) return 18;
  return String(value).length;
}

function columnWidth(input: TableWorkbookInput, index: number): number {
  const configured = input.columns[index]?.width;
  if (configured) return configured;
  const type = input.columns[index]?.type ?? "text";
  const header = input.columns[index]?.header ?? "";
  const content = input.rows.reduce((max, row) => Math.max(max, displayLength(row[index] ?? null)), header.length);
  const minimum = type === "money" || type === "decimal" ? 16 : type === "datetime" ? 20 : type === "percentage" ? 14 : 11;
  return Math.min(42, Math.max(minimum, content + 3));
}

function safeSheetName(value: string): string {
  const safe = value.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31);
  return safe || "รายงาน";
}

function worksheetXml(input: TableWorkbookInput): string {
  const lastColumn = columnName(input.columns.length - 1);
  const lastRow = Math.max(4, input.rows.length + 4);
  const title = `<row r="1" ht="28" customHeight="1">${cell("A1", input.title, 1)}</row>`;
  const subtitle = `<row r="2" ht="21" customHeight="1">${cell("A2", input.subtitle ?? "", 9)}</row>`;
  const headers = `<row r="4" ht="32" customHeight="1">${input.columns.map((column, index) => cell(`${columnName(index)}4`, column.header, 2)).join("")}</row>`;
  const detail = input.rows.map((row, rowIndex) => {
    const rowNumber = rowIndex + 5;
    return `<row r="${rowNumber}" ht="21" customHeight="1">${input.columns.map((column, columnIndex) => {
      const type = column.type ?? "text";
      return cell(`${columnName(columnIndex)}${rowNumber}`, row[columnIndex] ?? null, STYLE_BY_TYPE[type]);
    }).join("")}</row>`;
  }).join("");
  const columns = input.columns.map((_, index) => `<col min="${index + 1}" max="${index + 1}" width="${columnWidth(input, index)}" customWidth="1"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols>${columns}</cols>
  <sheetData>${title}${subtitle}${headers}${detail}</sheetData>
  <autoFilter ref="A4:${lastColumn}${lastRow}"/>
  <mergeCells count="2"><mergeCell ref="A1:${lastColumn}1"/><mergeCell ref="A2:${lastColumn}2"/></mergeCells>
</worksheet>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="5">
    <numFmt numFmtId="164" formatCode="#,##0.00;[Red](#,##0.00);-"/>
    <numFmt numFmtId="165" formatCode="0.00%"/>
    <numFmt numFmtId="166" formatCode="dd/mm/yyyy"/>
    <numFmt numFmtId="167" formatCode="dd/mm/yyyy hh:mm"/>
    <numFmt numFmtId="168" formatCode="#,##0.0000"/>
  </numFmts>
  <fonts count="3">
    <font><sz val="11"/><name val="Aptos"/></font>
    <font><b/><sz val="16"/><color rgb="FF123C68"/><name val="Aptos Display"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Aptos"/></font>
  </fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1769E0"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD8E6F5"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="10">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="168" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** สร้าง XLSX แบบตาราง อ่านง่ายใน Excel และเก็บตัวเลข/วันที่เป็น typed cells */
export function generateTableWorkbook(input: TableWorkbookInput): Uint8Array {
  if (input.columns.length === 0) throw new Error("ต้องมีอย่างน้อย 1 คอลัมน์");
  const now = new Date().toISOString();
  const sheetName = safeSheetName(input.sheetName ?? input.title);
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(input.title)}</dc:title><dc:creator>Lottery Management System</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`),
    "docProps/app.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Lottery Management System</Application></Properties>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(STYLES),
    "xl/worksheets/sheet1.xml": strToU8(worksheetXml(input)),
  };
  return zipSync(files, { level: 6 });
}

export function xlsxHeaders(filename: string): Record<string, string> {
  const wanted = filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`;
  const safeFilename = csvFilenamePart(wanted) || "report.xlsx";
  const fallback = safeFilename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "") || "report.xlsx";
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safeFilename)}`,
    "Cache-Control": "no-store",
  };
}

export function xlsxBody(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

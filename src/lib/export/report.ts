import { csvFile, csvHeaders } from "@/lib/csv";
import {
  generateTableWorkbook,
  xlsxBody,
  xlsxHeaders,
  type TableWorkbookCell,
  type TableWorkbookInput,
} from "@/lib/excel/table-workbook";

export type ReportExportInput = TableWorkbookInput & {
  /** ชื่อไฟล์โดยไม่ต้องใส่นามสกุล */
  filename: string;
};

export type ReportExportFormat = "csv" | "xlsx";

const BANGKOK_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** วันที่มาตรฐานสำหรับ CSV เพื่อให้ Excel Sort/Filter ได้โดยไม่กำกวม */
export function reportDate(value: Date, withTime = false): string {
  const parts = Object.fromEntries(BANGKOK_PARTS.formatToParts(value).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return withTime ? `${date} ${parts.hour}:${parts.minute}:${parts.second}` : date;
}

function csvValue(value: TableWorkbookCell, type: NonNullable<ReportExportInput["columns"][number]["type"]>): string {
  if (value === null || value === "") return "";
  if (value instanceof Date) return reportDate(value, type === "datetime");
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "0";
    if (type === "money") return value.toFixed(2);
    if (type === "percentage") return value.toString();
    if (type === "integer") return Math.trunc(value).toString();
    return value.toString();
  }
  return value;
}

/** CSV สะอาด: มีเฉพาะ Header + รายละเอียด ไม่แทรกแถวรวมปะปน */
export function generateReportCsv(input: ReportExportInput): string {
  return csvFile(
    input.columns.map((column) => column.header),
    input.rows.map((row) => input.columns.map((column, index) => csvValue(row[index] ?? null, column.type ?? "text"))),
  );
}

/** สร้าง payload ดาวน์โหลดจากสเปกเดียวกันทั้ง CSV และ Excel */
export function createReportDownload(input: ReportExportInput, format: ReportExportFormat): {
  body: string | ArrayBuffer;
  headers: Record<string, string>;
} {
  if (format === "xlsx") {
    const bytes = generateTableWorkbook(input);
    return { body: xlsxBody(bytes), headers: xlsxHeaders(`${input.filename}.xlsx`) };
  }
  return { body: generateReportCsv(input), headers: csvHeaders(`${input.filename}.csv`) };
}


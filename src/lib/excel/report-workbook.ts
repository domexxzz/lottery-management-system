import { generateTableWorkbook } from "./table-workbook";
import { generateReportCsv } from "@/lib/export/report";

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

function reportTableInput(input: ReportWorkbookInput) {
  const totals = input.rows.reduce((sum, row) => ({
    gross: sum.gross + row.gross,
    payout: sum.payout + row.payout,
    commission: sum.commission + row.commission,
    net: sum.net + row.net,
    bills: sum.bills + row.bills,
    items: sum.items + row.items,
    winners: sum.winners + row.winners,
  }), { gross: 0, payout: 0, commission: 0, net: 0, bills: 0, items: 0, winners: 0 });
  return {
    title: input.title,
    subtitle: `ช่วงข้อมูล: ${input.periodLabel} · กลุ่มข้อมูล: ${input.groupLabel}`,
    sheetName: "Details",
    metadata: [
      { label: "ช่วงข้อมูล", value: input.periodLabel },
      { label: "กลุ่มข้อมูล", value: input.groupLabel },
    ],
    summary: [
      { label: "จำนวนบิล", value: totals.bills, type: "integer", unit: "บิล" },
      { label: "จำนวนรายการเลข", value: totals.items, type: "integer", unit: "รายการ" },
      { label: "ยอดขายรวม", value: totals.gross, type: "money", unit: "บาท" },
      { label: "จ่ายรางวัลรวม", value: totals.payout, type: "money", unit: "บาท" },
      { label: "ค่าคอมมิชชันรวม", value: totals.commission, type: "money", unit: "บาท" },
      { label: "ยอดสุทธิ", value: totals.net, type: "money", unit: "บาท" },
      { label: "รายการถูกรางวัล", value: totals.winners, type: "integer", unit: "รายการ" },
    ],
    columns: [
      { header: "วันที่", type: "date", width: 13 }, { header: "รหัส", type: "text", width: 14 },
      { header: "รายการ", type: "text", width: 30 }, { header: "ยอดขาย", type: "money", width: 18 },
      { header: "จ่ายรางวัล", type: "money", width: 18 }, { header: "ค่าคอมมิชชัน", type: "money", width: 18 },
      { header: "ยอดสุทธิ", type: "money", width: 18 }, { header: "จำนวนบิล", type: "integer", width: 14 },
      { header: "จำนวนรายการเลข", type: "integer", width: 18 }, { header: "รายการถูกรางวัล", type: "integer", width: 18 },
    ],
    rows: input.rows.map((row) => [row.date, row.code, row.name, row.gross, row.payout, row.commission, row.net, row.bills, row.items, row.winners]),
  } as const;
}

/** กราฟใช้ตัวสร้าง Excel กลางเดียวกับรายงานฝั่ง Server */
export function generateReportWorkbook(input: ReportWorkbookInput): Uint8Array {
  return generateTableWorkbook(reportTableInput(input));
}

export function generateReportWorkbookCsv(input: ReportWorkbookInput): string {
  return generateReportCsv({
    filename: "report",
    ...reportTableInput(input),
  });
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

export function downloadReportCsv(input: ReportWorkbookInput, fileName: string): void {
  const csv = generateReportWorkbookCsv(input);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.endsWith(".csv") ? fileName : `${fileName}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

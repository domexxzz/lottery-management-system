import { describe, expect, test } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { generateTableWorkbook } from "@/lib/excel/table-workbook";
import { AGENT_OVERVIEW_EXPORT_COLUMNS } from "./export";

describe("Excel ภาพรวม Agent", () => {
  test("หัวตารางไม่ซ้ำและสร้างไฟล์ Excel ได้", () => {
    const headers = AGENT_OVERVIEW_EXPORT_COLUMNS.map((column) => column.header);
    expect(new Set(headers).size).toBe(headers.length);

    const bytes = generateTableWorkbook({
      title: "ภาพรวม Agent",
      sheetName: "Details",
      columns: AGENT_OVERVIEW_EXPORT_COLUMNS,
      rows: [["A001", "ตัวแทน กรุงเทพ", "ACTIVE", 0.3, 0.28, 2, 3, 1_000, 250, 300, 0, 300, 700]],
      generatedAt: new Date("2026-11-24T00:00:00.000Z"),
    });

    const files = unzipSync(bytes);
    const detail = strFromU8(files["xl/worksheets/sheet2.xml"]!);
    expect(detail).toContain("อัตราค่าคอมหวยลาวและหวยลาวชุด");
    expect(detail).toContain("ค่าคอมหวยลาวและหวยลาวชุด");
  });
});

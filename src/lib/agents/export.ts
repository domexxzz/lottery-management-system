import type { TableWorkbookColumn } from "@/lib/excel/table-workbook";

/**
 * หัวตารางกลางของไฟล์ภาพรวม Agent
 * แยกคำว่า "อัตรา" ออกจาก "จำนวนเงิน" เพื่อไม่ให้ Excel มีชื่อคอลัมน์ซ้ำกัน
 */
export const AGENT_OVERVIEW_EXPORT_COLUMNS = [
  { header: "รหัส Agent", type: "text", width: 14 },
  { header: "ชื่อ Agent", type: "text", width: 25 },
  { header: "สถานะ", type: "text", width: 14 },
  { header: "อัตราค่าคอมหวยรัฐบาล", type: "percentage", width: 22 },
  { header: "อัตราค่าคอมหวยลาวและหวยลาวชุด", type: "percentage", width: 30 },
  { header: "จำนวนลูกค้า", type: "integer", width: 16 },
  { header: "จำนวนบิล", type: "integer", width: 14 },
  { header: "ยอดขาย", type: "money", width: 18 },
  { header: "จ่ายรางวัล", type: "money", width: 18 },
  { header: "ค่าคอมหวยไทย", type: "money", width: 18 },
  { header: "ค่าคอมหวยลาวและหวยลาวชุด", type: "money", width: 25 },
  { header: "ค่าคอมมิชชันรวม", type: "money", width: 18 },
  { header: "ยอดสุทธิ", type: "money", width: 18 },
] as const satisfies readonly TableWorkbookColumn[];

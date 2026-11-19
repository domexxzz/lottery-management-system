import { InfoTip } from "./InfoTip";
import { MONEY_FORMAT } from "@/lib/reports/terms";
import type { ReportTermKey } from "@/lib/reports/terms";

type ReceiptLine = { label: string; value: number; term?: ReportTermKey };

/**
 * สมการกำไรแบบใบเสร็จ: ยอดขาย − จ่ายรางวัล − ค่าคอม = กำไร/ขาดทุน
 * จอใหญ่เรียงแนวนอน มือถือเรียงแนวตั้งเหมือนใบเสร็จ เครื่องหมาย − และ = ยังอยู่ครบทุกขนาดจอ
 * (เดิมมือถือซ่อนเครื่องหมาย เหลือกล่องสี่กล่องที่ดูไม่ออกว่าเกี่ยวกันอย่างไร)
 */
export function ProfitReceipt({ gross, payout, commission, profit, grossLabel = "ยอดขาย", grossTerm = "gross" }: {
  gross: number;
  payout: number;
  commission: number;
  profit: number;
  grossLabel?: string;
  grossTerm?: ReportTermKey;
}) {
  const lines: (ReceiptLine & { op: "" | "−" })[] = [
    { label: grossLabel, value: gross, term: grossTerm, op: "" },
    { label: "จ่ายรางวัล", value: payout, term: "payout", op: "−" },
    { label: "ค่าคอม Agent", value: commission, term: "commission", op: "−" },
  ];
  const loss = profit < 0;
  return (
    <ol className="profit-receipt" aria-label="ที่มาของกำไร/ขาดทุน">
      {lines.map((line) => (
        <li key={line.label} className="profit-receipt-line">
          <span className="profit-receipt-op" aria-hidden="true">{line.op}</span>
          <span className="profit-receipt-label">{line.label}{line.term && <InfoTip term={line.term} />}</span>
          <strong>{MONEY_FORMAT.format(line.value)}</strong>
        </li>
      ))}
      <li className={`profit-receipt-line is-result ${loss ? "is-loss" : "is-profit"}`}>
        <span className="profit-receipt-op" aria-hidden="true">=</span>
        <span className="profit-receipt-label">{loss ? "ขาดทุน" : "กำไร"}<InfoTip term="profit" /></span>
        <strong>{loss ? "−" : ""}{MONEY_FORMAT.format(Math.abs(profit))}</strong>
      </li>
    </ol>
  );
}

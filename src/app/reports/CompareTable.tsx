import { COUNT_FORMAT, MONEY_FORMAT } from "@/lib/reports/terms";

/**
 * ตารางเปรียบเทียบที่อ่านได้ทันที: ช่วงนี้ | ช่วงก่อน | เปลี่ยนแปลง (เป็นคำ)
 *
 * เดิมแสดงแค่ "▲ +1,200 (+12%)" ไม่บอกตัวเลขของช่วงก่อน และ ▲ เป็นสีเขียวเสมอ
 * แม้ตัวที่เพิ่มคือรายจ่าย (จ่ายรางวัลเพิ่ม = ไม่ดี) ตอนนี้สีบอกว่าดีหรือไม่ดีต่อเจ้าของ
 */
export type CompareRow = {
  label: string;
  current: number | null;
  previous: number | null;
  kind?: "money" | "count";
  /** เพิ่มขึ้นแล้วดีต่อเจ้าของไหม: up = ยิ่งมากยิ่งดี, down = ยิ่งน้อยยิ่งดี, neutral = แค่บอกข้อมูล */
  better: "up" | "down" | "neutral";
  unit?: string;
  /** แสดงแทนตัวเลขเมื่อเป็น null เช่น "ยังสรุปไม่ได้" */
  emptyText?: string;
  /** กำไร/ขาดทุน: แสดงคำว่ากำไรหรือขาดทุนนำหน้าตัวเลข */
  signedWord?: boolean;
};

function format(row: CompareRow, value: number | null): string {
  if (value === null) return row.emptyText ?? "—";
  const text = row.kind === "count" ? COUNT_FORMAT.format(Math.abs(value)) : MONEY_FORMAT.format(Math.abs(value));
  if (row.signedWord) return `${value < 0 ? "ขาดทุน" : "กำไร"} ${text}`;
  return `${value < 0 ? "−" : ""}${text}${row.unit ? ` ${row.unit}` : ""}`;
}

function change(row: CompareRow): { text: string; tone: "is-good" | "is-bad" | "is-neutral" } {
  if (row.current === null || row.previous === null) return { text: "เทียบไม่ได้", tone: "is-neutral" };
  const diff = Math.round((row.current - row.previous) * 100) / 100;
  if (diff === 0) return { text: "เท่าเดิม", tone: "is-neutral" };
  const amount = row.kind === "count" ? COUNT_FORMAT.format(Math.abs(diff)) : MONEY_FORMAT.format(Math.abs(diff));
  const percent = row.previous === 0 ? "" : ` (${diff > 0 ? "+" : "−"}${Math.abs(diff / Math.abs(row.previous) * 100).toFixed(1)}%)`;
  const word = row.signedWord ? (diff > 0 ? "ดีขึ้น" : "แย่ลง") : diff > 0 ? "มากขึ้น" : "น้อยลง";
  const good = row.better === "neutral" ? null : (diff > 0) === (row.better === "up");
  return {
    text: `${diff > 0 ? "▲" : "▼"} ${word} ${amount}${row.unit && !row.signedWord ? ` ${row.unit}` : ""}${percent}`,
    tone: good === null ? "is-neutral" : good ? "is-good" : "is-bad",
  };
}

export function CompareTable({ currentLabel, previousLabel, currentShort = "ช่วงนี้", previousShort = "ช่วงก่อน", rows, summary, note }: {
  currentLabel: string;
  previousLabel: string;
  /** หัวคอลัมน์สั้น (มือถือแคบ) ชื่อเต็มอยู่ใต้หัวคอลัมน์ */
  currentShort?: string;
  previousShort?: string;
  rows: CompareRow[];
  /** ประโยคสรุปภาษาพูด เช่น "เดือนนี้กำไรมากกว่าเดือนก่อน 2,000 บาท" */
  summary?: string;
  note?: string;
}) {
  return (
    <section className="cmp" aria-labelledby="cmp-heading">
      <header>
        <h2 id="cmp-heading">เทียบ <b>{currentLabel}</b> กับ <b>{previousLabel}</b></h2>
        {summary && <p className="cmp-summary">{summary}</p>}
      </header>
      <table className="cmp-table">
        <thead>
          <tr>
            <th scope="col">รายการ</th>
            <th scope="col" className="num">{currentShort}<small>{currentLabel}</small></th>
            <th scope="col" className="num">{previousShort}<small>{previousLabel}</small></th>
            <th scope="col" className="num">เปลี่ยนแปลง</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const result = change(row);
            return (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                <td className="num" data-label={currentShort}>{format(row, row.current)}</td>
                <td className="num" data-label={previousShort}>{format(row, row.previous)}</td>
                <td className={`num cmp-change ${result.tone}`} data-label="เปลี่ยนแปลง">{result.text}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="cmp-legend"><span className="is-good">สีเขียว</span> = ดีต่อเจ้าของ · <span className="is-bad">สีแดง</span> = ไม่ดี · สีเทา = แค่บอกข้อมูล{note ? ` · ${note}` : ""}</p>
    </section>
  );
}

/** ประโยคสรุปกำไร เช่น "เดือนนี้กำไร 14,000.00 บาท มากกว่า 1 – 19 ต.ค. (กำไร 12,000.00) อยู่ 2,000.00 บาท" */
export function profitSummary(currentLabel: string, previousLabel: string, current: number | null, previous: number | null): string | undefined {
  if (current === null) return `${currentLabel} ยังสรุปกำไรไม่ได้ เพราะยังไม่มีงวดที่คำนวณแล้ว`;
  const word = (value: number) => `${value < 0 ? "ขาดทุน" : "กำไร"} ${MONEY_FORMAT.format(Math.abs(value))} บาท`;
  if (previous === null) return `${currentLabel} ${word(current)} · ${previousLabel} ยังสรุปไม่ได้ จึงยังเทียบกำไรไม่ได้`;
  const diff = Math.round((current - previous) * 100) / 100;
  if (diff === 0) return `${currentLabel} ${word(current)} เท่ากับ ${previousLabel}`;
  return `${currentLabel} ${word(current)} ${diff > 0 ? "ดีกว่า" : "แย่กว่า"} ${previousLabel} (${word(previous)}) อยู่ ${MONEY_FORMAT.format(Math.abs(diff))} บาท`;
}

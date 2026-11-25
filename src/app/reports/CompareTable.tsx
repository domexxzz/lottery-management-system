import { DashboardIcon, type DashboardIconName } from "../DashboardIcon";
import { COUNT_FORMAT, MONEY_FORMAT } from "@/lib/reports/terms";

export type ComparisonRule = "profit" | "revenue" | "expense" | "neutral" | "winners";

export type CompareRow = {
  label: string;
  /** ค่าในช่วง A */
  current: number | null;
  /** ค่าในช่วง B */
  previous: number | null;
  rule: ComparisonRule;
  kind?: "money" | "count";
  unit?: string;
  emptyText?: string;
  signedWord?: boolean;
  icon?: DashboardIconName;
};

export type ComparisonNumbers = {
  diff: number;
  direction: "up" | "down" | "same";
  state: "changed" | "started" | "stopped" | "same";
  percent: number | null;
};

/** ชั้นที่ 1: คำนวณ B − A โดยยังไม่ตัดสินว่าผลดีหรือผลเสีย */
export function calculateComparison(a: number, b: number): ComparisonNumbers {
  const diff = Math.round((b - a) * 100) / 100;
  if (diff === 0) return { diff, direction: "same", state: "same", percent: 0 };
  const state = a === 0 ? "started" : b === 0 ? "stopped" : "changed";
  const percent = a === 0 ? null : Math.round((diff / Math.abs(a) * 100) * 10) / 10;
  return { diff, direction: diff > 0 ? "up" : "down", state, percent };
}

function format(row: CompareRow, value: number | null): string {
  if (value === null) return row.emptyText ?? "—";
  const text = row.kind === "count" ? COUNT_FORMAT.format(Math.abs(value)) : MONEY_FORMAT.format(Math.abs(value));
  if (row.signedWord) return `${value < 0 ? "ขาดทุน" : "กำไร"} ${text}`;
  return `${value < 0 ? "−" : ""}${text}${row.unit ? ` ${row.unit}` : ""}`;
}

function signedBaht(value: number): string {
  if (value === 0) return "คุ้มทุน 0.00 บาท";
  return `${value < 0 ? "ขาดทุน" : "กำไร"} ${MONEY_FORMAT.format(Math.abs(value))} บาท`;
}

export type ChangeResult = {
  direction: "up" | "down" | "same" | "na";
  word: string;
  amount: string;
  detail: string;
  percent: string;
  tone: "is-good" | "is-bad" | "is-neutral";
};

function formatPercent(value: number | null): string {
  if (value === null) return "";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(1)}%`;
}

/** ชั้นที่ 2: ตีความผลจากชั้นคำนวณตามกฎทางธุรกิจของแต่ละรายการ */
export function comparisonChange(row: CompareRow): ChangeResult {
  if (row.current === null || row.previous === null) {
    return { direction: "na", word: "เทียบไม่ได้", amount: "", detail: "", percent: "", tone: "is-neutral" };
  }

  const numbers = calculateComparison(row.current, row.previous);
  if (numbers.direction === "same") {
    return {
      direction: "same",
      word: row.current === 0 ? "ไม่มีการเปลี่ยนแปลง" : "เท่าเดิม",
      amount: "",
      detail: "",
      percent: row.current === 0 ? "" : "0.0%",
      tone: "is-neutral",
    };
  }

  const amount = row.kind === "count" ? COUNT_FORMAT.format(Math.abs(numbers.diff)) : MONEY_FORMAT.format(Math.abs(numbers.diff));
  const unit = row.unit && !row.signedWord ? ` ${row.unit}` : "";
  const crossedSign = row.rule === "profit" && ((row.current > 0 && row.previous < 0) || (row.current < 0 && row.previous > 0));

  if (row.rule === "profit") {
    const word = row.current > 0 && row.previous < 0
      ? "พลิกจากกำไรเป็นขาดทุน"
      : row.current < 0 && row.previous > 0
        ? "พลิกจากขาดทุนเป็นกำไร"
        : numbers.state === "started"
          ? row.previous > 0 ? "เริ่มมีกำไร" : "เริ่มขาดทุน"
          : numbers.diff > 0 ? "ดีขึ้น" : "แย่ลง";
    return {
      direction: numbers.direction,
      word,
      amount,
      detail: "",
      percent: crossedSign ? "" : formatPercent(numbers.percent),
      tone: numbers.diff > 0 ? "is-good" : "is-bad",
    };
  }

  if (row.rule === "expense") {
    return {
      direction: numbers.direction,
      word: numbers.state === "started" && numbers.diff > 0 ? "มีค่าใช้จ่ายเพิ่ม" : numbers.diff > 0 ? "ค่าใช้จ่ายเพิ่มขึ้น" : "ค่าใช้จ่ายลดลง",
      amount: `${amount}${unit}`,
      detail: "",
      percent: formatPercent(numbers.percent),
      tone: numbers.diff > 0 ? "is-bad" : "is-good",
    };
  }

  const isRevenue = row.rule === "revenue";
  const word = numbers.state === "started"
    ? isRevenue ? "เริ่มมียอดขาย" : row.rule === "winners" ? "เพิ่มขึ้น" : "เริ่มมีรายการ"
    : numbers.diff > 0 ? "เพิ่มขึ้น" : "ลดลง";
  return {
    direction: numbers.direction,
    word,
    amount: `${amount}${unit}`,
    detail: row.rule === "winners" && numbers.state === "started" && numbers.diff > 0 ? "(เริ่มมีผู้ถูกรางวัล)" : "",
    percent: formatPercent(numbers.percent),
    tone: isRevenue ? numbers.diff > 0 ? "is-good" : "is-bad" : "is-neutral",
  };
}

export type NarrativeItem = { tone: ChangeResult["tone"]; text: string };

/** สร้างคำอธิบายภาษาคนจากผลเปรียบเทียบ โดยไม่ตัดสินตัวเลขทั่วไปว่าเป็นผลดีหรือผลเสีย */
export function comparisonNarrative(rows: CompareRow[]): NarrativeItem[] {
  const items: NarrativeItem[] = [];
  for (const row of rows) {
    if (row.current === null || row.previous === null) continue;
    const result = comparisonChange(row);
    if (row.rule === "profit") {
      if (result.direction === "same") {
        items.push({ tone: "is-neutral", text: `ผลประกอบการทั้งสองช่วงเท่ากันที่ ${signedBaht(row.current)}` });
      } else {
        const impact = result.tone === "is-good" ? "ผลประกอบการดีขึ้น" : "ผลประกอบการแย่ลง";
        items.push({
          tone: result.tone,
          text: `${impact}: ช่วง A ${signedBaht(row.current)} ส่วนช่วง B ${signedBaht(row.previous)} — ${result.word} ${result.amount} บาท`,
        });
      }
      continue;
    }

    if (row.rule === "revenue") {
      const effect = result.direction === "same" ? "ยอดขายไม่เปลี่ยนแปลง" : `ยอดขาย${result.direction === "up" ? "เพิ่มขึ้น" : "ลดลง"} ${result.amount}${result.percent ? ` (${result.percent})` : ""}`;
      items.push({ tone: result.tone, text: `${effect}${result.direction === "same" ? "" : result.tone === "is-good" ? " เป็นสัญญาณด้านรายได้ที่ดีขึ้น" : " เป็นสัญญาณด้านรายได้ที่ลดลง"}` });
      continue;
    }

    if (row.rule === "expense") {
      const effect = result.direction === "same" ? `${row.label}ไม่เปลี่ยนแปลง` : `${row.label}: ${result.word} ${result.amount}${result.percent ? ` (${result.percent})` : ""}`;
      items.push({ tone: result.tone, text: `${effect}${result.direction === "same" ? "" : result.tone === "is-good" ? " ช่วยลดภาระค่าใช้จ่าย" : " ทำให้ภาระค่าใช้จ่ายเพิ่มขึ้น"}` });
      continue;
    }

    const valueText = result.direction === "same" ? `${row.label}ไม่มีการเปลี่ยนแปลง` : `${row.label}${result.word} ${result.amount}${result.percent ? ` (${result.percent})` : ""}${result.detail ? ` ${result.detail}` : ""}`;
    items.push({
      tone: "is-neutral",
      text: `${valueText} — เป็นข้อมูลประกอบ ไม่ได้หมายความว่าผลประกอบการดีขึ้นหรือแย่ลงโดยตรง`,
    });
  }
  return items;
}

export function CompareTable({ currentLabel, previousLabel, currentShort = "ช่วง A", previousShort = "ช่วง B", rows, note }: {
  currentLabel: string;
  previousLabel: string;
  currentShort?: string;
  previousShort?: string;
  rows: CompareRow[];
  note?: string;
}) {
  const profit = rows.find((row) => row.rule === "profit");
  const profitNumbers = profit?.current !== null && profit?.current !== undefined && profit.previous !== null
    ? calculateComparison(profit.current, profit.previous)
    : null;
  const narrative = comparisonNarrative(rows);

  return <section className="cmp" aria-labelledby="cmp-heading">
    <header className="cmp-heading">
      <span><DashboardIcon name="analytics" /></span>
      <div><h2 id="cmp-heading">สรุปความแตกต่างของข้อมูล</h2><p>ส่วนต่างคำนวณจากช่วง B − ช่วง A และใช้สีตามผลกระทบจริง</p></div>
    </header>

    {profit && profit.current !== null && profit.previous !== null && profitNumbers && <section className={`cmp-performance ${profitNumbers.diff > 0 ? "is-good" : profitNumbers.diff < 0 ? "is-bad" : "is-neutral"}`} aria-label="สรุปผลการเปรียบเทียบ">
      <header><DashboardIcon name="report" /><strong>สรุปผลการเปรียบเทียบ</strong></header>
      <div className="cmp-performance-grid">
        <article className="is-a"><span>{currentShort}</span><small>{currentLabel}</small><strong>{signedBaht(profit.current)}</strong></article>
        <article className="is-b"><span>{previousShort}</span><small>{previousLabel}</small><strong>{signedBaht(profit.previous)}</strong></article>
        <article className="is-result">
          <span>{profitNumbers.diff > 0 ? "ผลประกอบการดีขึ้น" : profitNumbers.diff < 0 ? "ผลประกอบการแย่ลง" : "ผลประกอบการเท่าเดิม"}</span>
          <strong>{MONEY_FORMAT.format(Math.abs(profitNumbers.diff))} บาท</strong>
          <small>{profit.current > 0 && profit.previous < 0 ? "ผลต่างระหว่างกำไรและขาดทุน" : profit.current < 0 && profit.previous > 0 ? "พลิกจากขาดทุนเป็นกำไร" : "ผลต่างสุทธิระหว่างสองช่วง"}</small>
        </article>
      </div>
    </section>}

    <div className="cmp-table-wrap"><table className="cmp-table">
      <thead><tr>
        <th scope="col"><span className="cmp-column-title"><DashboardIcon name="report" /> รายการ</span></th>
        <th scope="col" className="num cmp-period-head is-a"><b>{currentShort}</b><small>{currentLabel}</small></th>
        <th scope="col" className="num cmp-period-head is-b"><b>{previousShort}</b><small>{previousLabel}</small></th>
        <th scope="col" className="num"><span className="cmp-column-title cmp-column-change"><DashboardIcon name="reset" /> {previousShort} เทียบ {currentShort}</span></th>
      </tr></thead>
      <tbody>{rows.map((row) => {
        const result = comparisonChange(row);
        return <tr key={row.label}>
          <th scope="row"><span className="cmp-row-icon"><DashboardIcon name={row.icon ?? "report"} /></span><span>{row.label}</span></th>
          <td className="num cmp-value is-a" data-label={currentShort}>{format(row, row.current)}</td>
          <td className="num cmp-value is-b" data-label={previousShort}>{format(row, row.previous)}</td>
          <td className={`num cmp-change ${result.tone}`} data-label="เปลี่ยนแปลง">
            <span className="cmp-change-pill"><b aria-hidden="true">{result.direction === "up" ? "↑" : result.direction === "down" ? "↓" : result.direction === "same" ? "=" : "—"}</b><span><strong>{result.word}{result.amount ? ` ${result.amount}` : ""}{result.detail ? ` ${result.detail}` : ""}</strong>{result.percent && <small>{result.percent}</small>}</span></span>
          </td>
        </tr>;
      })}</tbody>
    </table></div>

    {narrative.length > 0 && <section className="cmp-written-summary" aria-labelledby="cmp-written-summary-heading">
      <header><span><DashboardIcon name="report" /></span><div><strong id="cmp-written-summary-heading">สรุปแบบเข้าใจง่าย</strong><small>อธิบายสิ่งที่เกิดขึ้นจากช่วง A ไปช่วง B</small></div></header>
      <ul>{narrative.map((item, index) => <li className={item.tone} key={`${index}-${item.text}`}><i aria-hidden="true" /><span>{item.text}</span></li>)}</ul>
    </section>}

    <footer className="cmp-footer">
      <p className="cmp-legend"><span className="is-good"><i />ผลดีขึ้น</span><span className="is-bad"><i />ผลแย่ลง</span><span className="is-neutral"><i />ข้อมูลทั่วไป</span></p>
      {note && <p className="cmp-note">หมายเหตุ: {note}</p>}
    </footer>
  </section>;
}

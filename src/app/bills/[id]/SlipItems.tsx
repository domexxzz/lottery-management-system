"use client";

import { useMemo, useState } from "react";

export type SlipItemRow = {
  id: string;
  order: number;
  number: string;
  prizeTypeName: string;
  stake: number;
  rate: string | null;
  status: "DRAFT" | "PENDING" | "WON" | "LOST" | "CANCELLED";
  statusLabel: string;
  /** ผลได้เสีย = ยอดจ่ายรางวัลเต็ม (เดิมพัน × อัตราจ่าย) ไม่หักอะไร; null = รอผล */
  prize: number | null;
};

const PAGE = 50;

function baht(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * รายการเลขในบิล สลับตาราง/การ์ดและค้นหาเลขได้ทันทีโดยไม่โหลดหน้าใหม่
 * แสดงครั้งละ 50 รายการ บิลใหญ่จึงไม่ทำให้หน้าหน่วง
 */
export function SlipItems({ rows, totalStake, prizeTotal }: { rows: SlipItemRow[]; totalStake: number; prizeTotal: number | null }) {
  const [view, setView] = useState<"table" | "card">("card");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const search = query.trim();
    return search ? rows.filter((row) => row.number.includes(search) || row.prizeTypeName.includes(search)) : rows;
  }, [rows, query]);
  const visible = filtered.slice(0, limit);

  return (
    <section className="slip-panel slip-items-panel" aria-labelledby="slip-items-heading">
      <header className="slip-panel-head slip-items-head">
        <h2 id="slip-items-heading">รายการเลขในบิล <span className="slip-pill">{rows.length} รายการ</span></h2>
        <div className="slip-items-tools">
          <div className="slip-segmented" role="group" aria-label="รูปแบบการแสดงผล">
            <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")}>ตาราง</button>
            <button type="button" aria-pressed={view === "card"} onClick={() => setView("card")}>การ์ด</button>
          </div>
          {rows.length > 8 && (
            <label className="slip-item-search">
              <span className="sr-only">ค้นหาตัวเลข</span>
              <input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(PAGE); }} placeholder="ค้นหาตัวเลข" inputMode="numeric" />
            </label>
          )}
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="slip-empty">ไม่พบเลขที่ค้นหา</p>
      ) : view === "table" ? (
        <div className="slip-table-scroll">
          <table className="slip-items-table">
            <thead>
              <tr>
                <th scope="col">ลำดับ</th>
                <th scope="col">ตัวเลข</th>
                <th scope="col">ประเภทรางวัล</th>
                <th scope="col" className="num">ยอดเดิมพัน</th>
                <th scope="col" className="num">อัตราจ่าย</th>
                <th scope="col">ผลรางวัล</th>
                <th scope="col" className="num">ผลได้เสีย</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td>{row.order}</td>
                  <td><strong className="slip-table-number">{row.number}</strong></td>
                  <td>{row.prizeTypeName}</td>
                  <td className="num">{baht(row.stake)}</td>
                  <td className="num">{row.rate === null ? "—" : `${row.rate} เท่า`}</td>
                  <td><span className={`slip-status slip-status-${row.status.toLowerCase()}`}>{row.statusLabel}</span></td>
                  <td className={`num ${row.prize !== null && row.prize > 0 ? "is-plus" : ""}`}>{row.prize === null ? "รอผล" : baht(row.prize)}</td>
                </tr>
              ))}
            </tbody>
            {!query && filtered.length <= limit && (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={3}>รวม {rows.length} รายการ</th>
                  <td className="num"><strong>{baht(totalStake)}</strong></td>
                  <td colSpan={2} />
                  <td className={`num ${prizeTotal !== null && prizeTotal > 0 ? "is-plus" : ""}`}><strong>{prizeTotal === null ? "รอผล" : baht(prizeTotal)}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : (
        <ol className="slip-items">
          {visible.map((row) => (
            <li key={row.id} className={`slip-item is-${row.status.toLowerCase()}`}>
              <header className="slip-item-head">
                <strong>ลำดับ {row.order}</strong>
                <span className={`slip-status slip-status-${row.status.toLowerCase()}`}>{row.statusLabel}</span>
              </header>
              <div className="slip-item-body">
                <div className="slip-item-number">
                  <strong>{row.number}</strong>
                  <span>{row.prizeTypeName}</span>
                </div>
                <dl>
                  <div><dt>อัตราจ่าย</dt><dd>{row.rate === null ? "—" : `${row.rate} เท่า`}</dd></div>
                  <div><dt>ผลรางวัล</dt><dd>{row.prize === null ? "รอผล" : row.statusLabel}</dd></div>
                </dl>
              </div>
              <footer className="slip-item-foot">
                <span>ราคาแทง <strong>{baht(row.stake)} บาท</strong></span>
                <span>ผลได้เสีย <strong className={row.prize !== null && row.prize > 0 ? "is-plus" : ""}>{row.prize === null ? "รอผล" : `${baht(row.prize)} บาท`}</strong></span>
              </footer>
            </li>
          ))}
        </ol>
      )}

      {filtered.length > limit && (
        <footer className="slip-items-more">
          <span>แสดง {visible.length} จาก {filtered.length} รายการ</span>
          <button type="button" onClick={() => setLimit((value) => value + PAGE)}>แสดงเพิ่มอีก {Math.min(PAGE, filtered.length - limit)} รายการ</button>
        </footer>
      )}
    </section>
  );
}

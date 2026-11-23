"use client";

import { Fragment, useMemo, useState } from "react";
import { LotteryFlag } from "../ThaiFlag";
import { DeleteBillItemButton, InlineEditBillItemForm } from "./BillActions";

export type SlipItemRow = {
  id: string;
  billId: string;
  order: number;
  number: string;
  lotteryType: string;
  lotteryLabel: string;
  prizeTypeName: string;
  /** ประเภทย่อยหวยลาวชุด: ชุด 30/60/120 บาท */
  packageLabel: string | null;
  quantity: number;
  /** ราคาต่อชุดสำหรับหวยลาวชุด หรือยอดเดิมพันสำหรับหวยทั่วไป */
  unitStake: number;
  digits: number;
  canManage: boolean;
  stake: number;
  rate: string | null;
  rateText: string;
  status: "DRAFT" | "PENDING" | "WON" | "LOST" | "CANCELLED";
  statusLabel: string;
  /** รางวัลย่อยทั้งหมดที่เลขชุดนี้ถูก */
  winningPrizes: Array<{ id: string; label: string; rate: number; payout: number; isPaid: boolean }>;
  /** ผลได้เสีย = ยอดจ่ายรางวัลเต็ม (เดิมพัน × อัตราจ่าย) ไม่หักอะไร; null = รอผล */
  prize: number | null;
};

const PAGE = 50;
const LOTTERY_ORDER: Record<string, number> = { THAI_GOVERNMENT: 0, LAO: 1, LAO_SET: 2 };

function baht(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function LotteryBadge({ type, label }: { type: string; label: string }) {
  return (
    <span className={`slip-lottery-badge is-${type.toLowerCase()}`}>
      <LotteryFlag lotteryType={type} />
      <b>{label}</b>
    </span>
  );
}

/**
 * รายการเลขในบิล สลับตาราง/การ์ดและค้นหาเลขได้ทันทีโดยไม่โหลดหน้าใหม่
 * แสดงครั้งละ 50 รายการ บิลใหญ่จึงไม่ทำให้หน้าหน่วง
 */
export function SlipItems({ rows, totalStake, prizeTotal, heading = "รายการเลขในบิล" }: { rows: SlipItemRow[]; totalStake: number; prizeTotal: number | null; heading?: string }) {
  const [view, setView] = useState<"table" | "card">("card");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const orderedRows = useMemo(() => rows.map((row, index) => ({ row, index })).sort((a, b) => {
    const lottery = (LOTTERY_ORDER[a.row.lotteryType] ?? 99) - (LOTTERY_ORDER[b.row.lotteryType] ?? 99);
    if (lottery !== 0) return lottery;
    if (a.row.lotteryType === "LAO_SET" && b.row.lotteryType === "LAO_SET") {
      const packageOrder = a.row.unitStake - b.row.unitStake;
      if (packageOrder !== 0) return packageOrder;
    }
    return a.index - b.index;
  }).map(({ row }) => row), [rows]);

  const filtered = useMemo(() => {
    const search = query.trim();
    return search ? orderedRows.filter((row) => row.number.includes(search) || row.prizeTypeName.includes(search) || row.lotteryLabel.includes(search) || row.packageLabel?.includes(search) || row.winningPrizes.some((prize) => prize.label.includes(search))) : orderedRows;
  }, [orderedRows, query]);
  const visible = filtered.slice(0, limit);
  const filteredGroupMetrics = useMemo(() => {
    const metrics = new Map<string, { itemCount: number; setCount: number; stake: number }>();
    for (const row of filtered) {
      const key = row.lotteryType === "LAO_SET" ? `${row.lotteryType}:${row.unitStake}` : row.lotteryType;
      const current = metrics.get(key) ?? { itemCount: 0, setCount: 0, stake: 0 };
      current.itemCount += 1;
      current.setCount += row.quantity;
      current.stake += row.stake;
      metrics.set(key, current);
    }
    return metrics;
  }, [filtered]);
  const visibleGroups = useMemo(() => {
    const groups = new Map<string, { key: string; lotteryType: string; label: string; packagePrice: number | null; rows: SlipItemRow[] }>();
    for (const row of visible) {
      const packagePrice = row.lotteryType === "LAO_SET" ? row.unitStake : null;
      const key = packagePrice === null ? row.lotteryType : `${row.lotteryType}:${packagePrice}`;
      const label = row.lotteryType === "THAI_GOVERNMENT" ? "หวยรัฐบาล" : row.lotteryType === "LAO" ? "หวยลาว" : "หวยลาวชุด";
      const group = groups.get(key) ?? { key, lotteryType: row.lotteryType, label, packagePrice, rows: [] };
      group.rows.push(row);
      groups.set(key, group);
    }
    return [...groups.values()].map((group) => ({ ...group, ...(filteredGroupMetrics.get(group.key) ?? { itemCount: 0, setCount: 0, stake: 0 }) }));
  }, [visible, filteredGroupMetrics]);

  function groupSummary(group: (typeof visibleGroups)[number]) {
    return group.packagePrice === null
      ? `${group.itemCount.toLocaleString("th-TH")} รายการ · ${baht(group.stake)} บาท`
      : `ชุดละ ${group.packagePrice.toLocaleString("th-TH")} บาท · ${group.setCount.toLocaleString("th-TH")} ชุด · ${group.packagePrice.toLocaleString("th-TH")} × ${group.setCount.toLocaleString("th-TH")} = ${baht(group.stake)} บาท`;
  }

  return (
    <section className="slip-panel slip-items-panel" aria-labelledby="slip-items-heading">
      <header className="slip-panel-head slip-items-head">
        <h2 id="slip-items-heading">{heading} <span className="slip-pill">{rows.length} รายการ</span></h2>
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
                <th scope="col">เลขที่กรอก</th>
                <th scope="col">ประเภทหวย</th>
                <th scope="col">ประเภทรางวัล</th>
                <th scope="col" className="num">ยอดเดิมพัน</th>
                <th scope="col" className="num">อัตราจ่าย</th>
                <th scope="col">ผลรางวัล</th>
                <th scope="col" className="num">ผลได้เสีย</th>
              </tr>
            </thead>
            <tbody>
              {visibleGroups.map((group) => (
                <Fragment key={group.key}>
                  <tr className={`slip-table-group is-${group.lotteryType.toLowerCase()}`}>
                    <th colSpan={8}><LotteryBadge type={group.lotteryType} label={group.label} /><span>{groupSummary(group)}</span></th>
                  </tr>
                  {group.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.order}</td>
                  <td><strong className="slip-table-number">{row.number}</strong></td>
                  <td><LotteryBadge type={row.lotteryType} label={row.lotteryLabel} /></td>
                  <td><span className="slip-prize-type">{row.prizeTypeName}{row.packageLabel && <small>{row.packageLabel} × {row.quantity} ชุด</small>}</span></td>
                  <td className="num">{baht(row.stake)}</td>
                  <td className="num">{row.rateText}</td>
                  <td>
                    <span className="slip-result-cell">
                      <span className={`slip-status slip-status-${row.status.toLowerCase()}`}>{row.statusLabel}</span>
                      {row.winningPrizes.map((prize) => <strong key={prize.id} className={`slip-winning-prize-label ${prize.isPaid ? "is-paid" : "is-suppressed"}`}>{prize.isPaid ? "เลือกจ่าย" : "ตรวจพบ · ไม่จ่าย"} {prize.label} · {baht(prize.payout)}</strong>)}
                    </span>
                  </td>
                  <td className={`num ${row.prize !== null && row.prize > 0 ? "is-plus" : ""}`}>{row.prize === null ? "รอผล" : baht(row.prize)}</td>
                </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
            {!query && filtered.length <= limit && (
              <tfoot>
                <tr>
                  <th scope="row" colSpan={4}>รวม {rows.length} รายการ</th>
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
          {visibleGroups.map((group) => (
            <Fragment key={group.key}>
              <li className={`slip-item-group is-${group.lotteryType.toLowerCase()}`}>
                <LotteryBadge type={group.lotteryType} label={group.label} />
                <span>{groupSummary(group)}</span>
              </li>
          {group.rows.map((row) => (
            <li key={row.id} className={`slip-item is-${row.status.toLowerCase()}`}>
              <header className="slip-item-head">
                <span className="slip-item-head-left">
                  <strong>ลำดับ {row.order}</strong>
                  <LotteryBadge type={row.lotteryType} label={row.lotteryLabel} />
                </span>
                <span className="slip-item-head-side">
                  <span className={`slip-status slip-status-${row.status.toLowerCase()}`}>{row.statusLabel}</span>
                  {row.canManage && (
                    <span className="slip-card-actions">
                      <button type="button" className="slip-card-action is-edit" onClick={() => setEditingId((current) => current === row.id ? null : row.id)} aria-expanded={editingId === row.id}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                        แก้ไข
                      </button>
                      <DeleteBillItemButton billId={row.billId} itemId={row.id} label={`${row.number} ${row.prizeTypeName}`} />
                    </span>
                  )}
                </span>
              </header>
              <div className="slip-item-body">
                <div className="slip-item-number">
                  <small className="slip-number-label">เลขที่กรอก</small>
                  <strong>{row.number}</strong>
                  <span>{row.prizeTypeName}{row.packageLabel && <small className="slip-package-label">{row.packageLabel} × {row.quantity} ชุด</small>}</span>
                </div>
                <dl>
                  <div><dt>อัตราจ่าย</dt><dd>{row.rateText}</dd></div>
                  <div><dt>ผลรางวัล</dt><dd>{row.prize === null ? "รอผล" : row.winningPrizes.length > 0 ? <><span>ตรวจพบ {row.winningPrizes.length} รางวัล · เลือกจ่าย 1 รางวัล</span>{row.winningPrizes.map((prize) => <strong key={prize.id} className={`slip-winning-prize-label ${prize.isPaid ? "is-paid" : "is-suppressed"}`}>{prize.isPaid ? "เลือกจ่าย" : "ตรวจพบ · ไม่จ่าย"} {prize.label} · {baht(prize.payout)}</strong>)}</> : row.statusLabel}</dd></div>
                </dl>
              </div>
              <footer className="slip-item-foot">
                <span>{row.packageLabel ? "ราคา × จำนวน" : "ราคาแทง"} <strong>{row.packageLabel ? `${row.packageLabel} × ${row.quantity} = ${baht(row.stake)} บาท` : `${baht(row.stake)} บาท`}</strong></span>
                <span>ผลได้เสีย <strong className={row.prize !== null && row.prize > 0 ? "is-plus" : ""}>{row.prize === null ? "รอผล" : `${baht(row.prize)} บาท`}</strong></span>
              </footer>
              {editingId === row.id && (
                <InlineEditBillItemForm
                  item={{ billId: row.billId, itemId: row.id, number: row.number, unitStake: row.unitStake, quantity: row.quantity, digits: row.digits, packageLabel: row.packageLabel }}
                  onClose={() => setEditingId(null)}
                />
              )}
            </li>
          ))}
            </Fragment>
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

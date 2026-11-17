"use client";

import { useRef } from "react";
import {
  compactRate,
  groupPrizeTypes,
  MAX_STAKE_PER_ITEM,
  MIN_STAKE_PER_ITEM,
  type BetPrizeType,
  type MatchRuleName,
} from "@/lib/bills/betting";
import { LAO_PRIZE_TYPES, type LaoSegment } from "@/lib/lao/rules";
import type { SlipRestriction } from "./BetSlip";

/**
 * ปุ่ม "ดูกติกา" และ popup กติกา/อัตราจ่าย ของหน้าสร้างบิล
 *
 * ใช้ร่วมกันทุกประเภทหวย อัตราจ่ายมาจาก Rulebook ของประเภทที่เลือกจริง
 * ส่วนคำอธิบายว่าเทียบกับเลขไหนเขียนตามตรรกะตัดสินใน lib/glo/results.ts และ lib/lao/rules.ts
 * ถ้าแก้ตรรกะตัดสินที่นั่น ต้องแก้ข้อความที่นี่ด้วย
 */

const MATCH_RULE_TEXT: Record<MatchRuleName, string> = {
  EXACT: "ตรงทุกหลักและเรียงตามลำดับ",
  PERMUTATION: "ตัวเลขครบทุกหลัก สลับตำแหน่งได้",
  CONTAINS_DIGIT: "มีเลขนี้อยู่ตำแหน่งใดก็ได้",
};

/** เลขที่ใช้ตัดสินของหวยรัฐบาล ตามรหัสรางวัล */
const THAI_SOURCE: Record<number, string> = {
  1: "3 หลักท้ายของรางวัลที่ 1",
  2: "3 หลักท้ายของรางวัลที่ 1",
  3: "เลขหน้า 3 ตัว (2 เลข)",
  4: "เลขท้าย 3 ตัว (2 เลข)",
  5: "2 หลักท้ายของรางวัลที่ 1",
  6: "เลขท้าย 2 ตัว",
  7: "2 หลักท้ายของรางวัลที่ 1",
  8: "3 หลักท้ายของรางวัลที่ 1",
  9: "เลขท้าย 2 ตัว",
  12: "4 หลักท้ายของรางวัลที่ 1",
  13: "4 หลักท้ายของรางวัลที่ 1",
  14: "5 หลักท้ายของรางวัลที่ 1",
  15: "รางวัลที่ 1 ทั้ง 6 หลัก",
  16: "เลขท้าย 2 ตัว",
};

const LAO_SEGMENT_TEXT: Record<LaoSegment, string> = {
  LAST4: "4 ตัวท้ายของเลขที่ออก",
  LAST3: "3 ตัวท้าย",
  FIRST3: "3 ตัวหน้าของ 4 ตัวท้าย",
  LAST2: "2 ตัวท้าย",
  FIRST2: "2 ตัวหน้าของ 4 ตัวท้าย",
};
const LAO_SEGMENT_BY_CODE = new Map(LAO_PRIZE_TYPES.map((prize) => [prize.code, prize.segment]));

function sourceOf(lotteryType: string, code: number): string | null {
  if (lotteryType === "THAI_GOVERNMENT") return THAI_SOURCE[code] ?? null;
  const segment = LAO_SEGMENT_BY_CODE.get(code);
  return segment ? LAO_SEGMENT_TEXT[segment] : null;
}

function resultNote(lotteryType: string): string {
  if (lotteryType === "THAI_GOVERNMENT") {
    return "ตัดสินจากผลสลากกินแบ่งรัฐบาลที่ประกาศทางการ เลขบนอ้างอิงรางวัลที่ 1 ส่วนเลขล่างอ้างอิงเลขท้าย 2 ตัว";
  }
  return "ตัดสินจาก 4 ตัวท้ายของเลขที่ออก (ผลยาว 4–6 หลัก) เช่น ออก 651234 ใช้ 1234 · 3 ตัวท้าย 234 · 3 ตัวหน้า 123 · 2 ตัวบน 34 · 2 ตัวล่าง 12";
}

const MAX_NUMBERS_SHOWN = 40;

export function RulesDialog({
  lotteryType,
  lotteryLabel,
  drawLabel,
  cutoffLabel,
  prizeTypes,
  restrictions,
}: {
  lotteryType: string;
  lotteryLabel: string;
  drawLabel: string;
  cutoffLabel: string;
  prizeTypes: BetPrizeType[];
  restrictions: SlipRestriction[];
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const groups = groupPrizeTypes(prizeTypes);
  const example = groups.filter((group) => group.key !== "run").at(-1)?.prizeTypes[0];
  const nameById = new Map(prizeTypes.map((prizeType) => [prizeType.id, prizeType.name]));

  const reduced = restrictions.filter((row) => row.kind === "REDUCED_RATE");
  const closed = restrictions.filter((row) => row.kind === "CLOSED");
  const byPrize = (rows: SlipRestriction[]) => {
    const map = new Map<string, SlipRestriction[]>();
    for (const row of rows) {
      const items = map.get(row.prizeTypeId) ?? [];
      // เลขเต็มกับเลขที่ปิดรับเองอาจเป็นเลขเดียวกัน แสดงครั้งเดียวพอ
      if (!items.some((item) => item.number === row.number)) map.set(row.prizeTypeId, [...items, row]);
    }
    return [...map.entries()]
      .filter(([prizeTypeId]) => nameById.has(prizeTypeId))
      .map(([prizeTypeId, items]) => ({ name: nameById.get(prizeTypeId)!, items: items.sort((a, b) => a.number.localeCompare(b.number)) }));
  };

  return (
    <>
      <button type="button" className="bs-rules-button" onClick={() => dialogRef.current?.showModal()}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19.5V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z" /><path d="M8 7h7M8 11h5" /></svg>
        ดูกติกา
      </button>
      <dialog
        ref={dialogRef}
        className="bs-rules-dialog"
        aria-labelledby="bs-rules-title"
        onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      >
        <div className="bs-rules-body">
          <header className="bs-rules-head">
            <div>
              <p>กติกาและอัตราจ่าย</p>
              <h2 id="bs-rules-title">{lotteryLabel} · งวด {drawLabel}</h2>
            </div>
            <button type="button" className="bs-rules-close" aria-label="ปิด" onClick={() => dialogRef.current?.close()}>×</button>
          </header>

          <section>
            <h3>อัตราจ่าย</h3>
            {groups.length === 0 ? <p className="bs-rules-empty">ยังไม่มีประเภทที่เปิดรับ</p> : (
              <div className="bs-rules-table-wrap">
                <table className="bs-rules-table">
                  <thead><tr><th>ประเภท</th><th>ถูกเมื่อ</th><th>จ่ายบาทละ</th></tr></thead>
                  {groups.map((group) => (
                    <tbody key={group.key}>
                      <tr className="bs-rules-group"><th colSpan={3}>{group.label}</th></tr>
                      {group.prizeTypes.map((prizeType) => {
                        const source = sourceOf(lotteryType, prizeType.code);
                        return (
                          <tr key={prizeType.id}>
                            <td><strong>{prizeType.name}</strong></td>
                            <td>{source ? <>{source}<br /></> : null}<small>{MATCH_RULE_TEXT[prizeType.matchRule]}</small></td>
                            <td className="bs-rules-rate">{Number(compactRate(prizeType.payoutRate)).toLocaleString("th-TH")}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  ))}
                </table>
              </div>
            )}
            {example && <p className="bs-rules-note">ตัวอย่าง: แทง {example.name} 10 บาท ถูกได้ {(Number(example.payoutRate) * 10).toLocaleString("th-TH")} บาท (10 × {compactRate(example.payoutRate)})</p>}
          </section>

          <section>
            <h3>กติกาการแทง</h3>
            <ul className="bs-rules-list">
              <li>{resultNote(lotteryType)}</li>
              <li>แทงขั้นต่ำ {MIN_STAKE_PER_ITEM} บาท สูงสุด {MAX_STAKE_PER_ITEM.toLocaleString("th-TH")} บาท ต่อเลขต่อรายการ ยอดรวมทั้งบิลไม่จำกัด</li>
              <li>ได้เฉพาะประเภทที่แทง ถ้าเลขเดียวกันถูกหลายประเภทที่แทงไว้ ได้รับรวมทุกประเภท</li>
              <li>ปุ่ม &ldquo;สลับเลข&rdquo; ช่วยแตกเลขทุกชุดเป็นรายการแยก แต่ละรายการคิดเงินแยกกัน ไม่ใช่ประเภทรางวัลใหม่</li>
              <li>เลขอั้นจ่ายตามอัตราที่ลดลง และเลขปิดรับ/เลขเต็มแทงไม่ได้ ระบบตรวจซ้ำอีกครั้งตอนยืนยันบิล</li>
              <li>ปิดรับ {cutoffLabel} บิลที่ยืนยันหลังเวลานี้จะไม่ถูกรับ</li>
            </ul>
          </section>

          <section>
            <h3>เลขอั้นงวดนี้</h3>
            {reduced.length === 0 ? <p className="bs-rules-empty">ไม่มีเลขอั้น</p> : byPrize(reduced).map((group) => (
              <div key={group.name} className="bs-rules-numbers">
                <b>{group.name}</b>
                <div>
                  {group.items.slice(0, MAX_NUMBERS_SHOWN).map((row) => <span key={row.number} className="is-reduced">{row.number}<small>จ่าย {compactRate(row.payoutRate ?? "0")}</small></span>)}
                  {group.items.length > MAX_NUMBERS_SHOWN && <em>+{group.items.length - MAX_NUMBERS_SHOWN} เลข</em>}
                </div>
              </div>
            ))}
          </section>

          <section>
            <h3>เลขปิดรับ / เลขเต็ม</h3>
            {closed.length === 0 ? <p className="bs-rules-empty">ไม่มีเลขปิดรับ</p> : byPrize(closed).map((group) => (
              <div key={group.name} className="bs-rules-numbers">
                <b>{group.name}</b>
                <div>
                  {group.items.slice(0, MAX_NUMBERS_SHOWN).map((row) => <span key={row.number} className="is-closed">{row.number}</span>)}
                  {group.items.length > MAX_NUMBERS_SHOWN && <em>+{group.items.length - MAX_NUMBERS_SHOWN} เลข</em>}
                </div>
              </div>
            ))}
          </section>

          <footer className="bs-rules-foot">
            <button type="button" onClick={() => dialogRef.current?.close()}>เข้าใจแล้ว</button>
          </footer>
        </div>
      </dialog>
    </>
  );
}

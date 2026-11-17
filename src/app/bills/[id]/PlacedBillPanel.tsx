"use client";

import Link from "next/link";
import { useEffect } from "react";
import { clearDraft } from "../new/slip-safety";

/**
 * แผงผลลัพธ์หลังสร้างบิลสำเร็จจากหน้าสร้างบิล
 *
 * ล้างร่างในเครื่องของหน้าสร้างบิลที่นี่ เพราะหน้านี้เปิดได้ก็ต่อเมื่อ Server สร้างบิลแล้วจริง
 * ถ้าเน็ตหลุดก่อนมาถึงหน้านี้ ร่างยังอยู่ และกู้คืนแล้วส่งซ้ำก็ได้บิลเดิม (รหัสกันซ้ำเดิม)
 */
export function PlacedBillPanel({
  sequence,
  customer,
  itemCount,
  totalStake,
  lotteryType,
  draftScope,
  duplicate,
}: {
  sequence: number;
  customer: string;
  itemCount: number;
  totalStake: string;
  lotteryType: string;
  draftScope: string;
  duplicate: boolean;
}) {
  useEffect(() => {
    clearDraft(draftScope);
  }, [draftScope]);

  const total = Number(totalStake).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <section className="placed-bill-panel" role="status" aria-labelledby="placed-bill-heading">
      <span className="placed-bill-check" aria-hidden="true">✓</span>
      <div className="placed-bill-copy">
        <h2 id="placed-bill-heading">{duplicate ? "บิลนี้สร้างไว้แล้ว" : "สร้างบิลสำเร็จ"}</h2>
        {duplicate && <p>ระบบได้รับคำขอซ้ำ จึงแสดงบิลเดิมโดยไม่สร้างบิลใหม่</p>}
        <dl>
          <div><dt>เลขบิล</dt><dd>บิล {sequence.toLocaleString("th-TH")}</dd></div>
          <div><dt>ลูกค้า</dt><dd>{customer}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{itemCount.toLocaleString("th-TH")} รายการ</dd></div>
          <div className="is-total"><dt>ยอดรวม</dt><dd>{total} บาท</dd></div>
        </dl>
      </div>
      <nav className="placed-bill-actions" aria-label="ทำต่อหลังสร้างบิล">
        <Link href={`/bills/new?lottery=${lotteryType}`} className="placed-bill-next">＋ สร้างบิลถัดไป</Link>
        <a href="#bill-evidence" className="placed-bill-secondary">แนบหลักฐาน</a>
        <a href="#bill-items" className="placed-bill-secondary">ดูรายละเอียด</a>
      </nav>
    </section>
  );
}

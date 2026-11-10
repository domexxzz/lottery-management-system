"use client";

import { useActionState } from "react";
import { AppDropdown } from "../AppDropdown";
import { updatePrizeTypeAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, message: null };

const MATCH_RULE_LABEL: Record<string, string> = {
  EXACT: "ตรงทุกหลัก",
  PERMUTATION: "เลขโต๊ด",
  CONTAINS_DIGIT: "เลขวิ่ง",
};

export type PrizeTypeRowData = {
  id: string;
  code: number;
  name: string;
  digits: number;
  /** ว่าง = เท่ากับ digits */
  resultDigits: string;
  matchRule: string;
  payoutRate: string;
  maxStakePerItem: string;
  isActive: boolean;
  usedInItems: number;
};

function displayNumber(value: string) {
  const number = Number(value);
  return Number.isFinite(number)
    ? new Intl.NumberFormat("th-TH", { maximumFractionDigits: 4 }).format(number)
    : value;
}

export function PrizeTypeRow({ data }: { data: PrizeTypeRowData }) {
  const [state, formAction, pending] = useActionState(updatePrizeTypeAction, INITIAL);
  const resultDigits = data.resultDigits || String(data.digits);

  return (
    <details className={`rulebook-prize-card ${data.isActive ? "is-active" : "is-inactive"}`}>
      <summary>
        <span className="rulebook-prize-code" aria-label={`รหัส ${data.code}`}>{data.code}</span>
        <span className="rulebook-prize-name">
          <strong>{data.name}</strong>
          <small>แทง {data.digits} หลัก · ใช้ผล {resultDigits} หลัก · {MATCH_RULE_LABEL[data.matchRule] ?? data.matchRule}</small>
        </span>
        <span className="rulebook-prize-rate">
          <small>จ่ายบาทละ</small>
          <strong>{displayNumber(data.payoutRate)}</strong>
        </span>
        <span className={`rulebook-prize-status ${data.isActive ? "is-on" : "is-off"}`}>
          {data.isActive ? "เปิดใช้งาน" : "ปิดใช้งาน"}
        </span>
        <span className="rulebook-prize-expand"><span>แก้ไขการตั้งค่า</span><i aria-hidden="true">⌄</i></span>
      </summary>

      <form action={formAction} className="rulebook-prize-form">
        <input type="hidden" name="prizeTypeId" value={data.id} />

        <section className="rulebook-form-section" aria-labelledby={`basic-${data.id}`}>
          <header>
            <span>1</span>
            <div><h3 id={`basic-${data.id}`}>ข้อมูลประเภทรางวัล</h3><p>กำหนดชื่อที่ผู้ใช้เห็นและจำนวนหลักของเลข</p></div>
          </header>
          <div className="rulebook-form-grid">
            <label className="rulebook-field rulebook-field-wide">
              <span>ชื่อประเภท</span>
              <small>ชื่อที่แสดงในหน้าสร้างบิล เช่น “3 ตัวบนตรง”</small>
              <input name="name" defaultValue={data.name} required maxLength={60} />
            </label>
            <label className="rulebook-field">
              <span>จำนวนหลักที่ลูกค้ากรอก</span>
              <small>เช่น เลข 3 ตัว ให้ใส่ 3</small>
              <input name="digits" type="number" min={1} max={6} defaultValue={data.digits} required />
            </label>
            <label className="rulebook-field">
              <span>จำนวนหลักจากผลรางวัล</span>
              <small>เว้นว่างเพื่อใช้เท่ากับเลขที่ลูกค้ากรอก</small>
              <input name="resultDigits" type="number" min={1} max={6} defaultValue={data.resultDigits} placeholder={`อัตโนมัติ (${data.digits} หลัก)`} />
            </label>
          </div>
        </section>

        <section className="rulebook-form-section" aria-labelledby={`payment-${data.id}`}>
          <header>
            <span>2</span>
            <div><h3 id={`payment-${data.id}`}>การจ่ายและการตรวจรางวัล</h3><p>กำหนดเงินรางวัลและวิธีเปรียบเทียบเลข</p></div>
          </header>
          <div className="rulebook-form-grid">
            <label className="rulebook-field">
              <span>อัตราจ่ายต่อ 1 บาท</span>
              <small>ตัวอย่าง: ใส่ 650 หมายถึงแทง 1 บาท จ่าย 650 บาท</small>
              <input name="payoutRate" inputMode="decimal" defaultValue={data.payoutRate} required />
            </label>
            <label className="rulebook-field">
              <span>เดิมพันสูงสุดต่อเลข</span>
              <small>จำกัดเงินของเลขหนึ่งรายการ หรือเว้นว่างหากไม่จำกัด</small>
              <input name="maxStakePerItem" inputMode="decimal" defaultValue={data.maxStakePerItem} placeholder="ไม่จำกัด" />
            </label>
            <div className="rulebook-field">
              <span>วิธีตรวจรางวัล</span>
              <small>เลือกว่าต้องเรียงตรง หรือสลับตำแหน่งได้</small>
              <AppDropdown
                id={`matchRule-${data.id}`}
                name="matchRule"
                defaultValue={data.matchRule}
                ariaLabel={`วิธีตรวจรางวัล ${data.name}`}
                options={[
                  { value: "EXACT", label: "ตรงทุกหลัก", description: "เลขและตำแหน่งต้องตรงกับผลรางวัลทั้งหมด" },
                  { value: "PERMUTATION", label: "เลขโต๊ด", description: "ตัวเลขเหมือนกันครบทุกตัว สลับตำแหน่งได้" },
                  { value: "CONTAINS_DIGIT", label: "เลขวิ่ง", description: "ผลรางวัลมีเลขที่ลูกค้าเลือกอยู่" },
                ]}
              />
            </div>
          </div>
        </section>

        <section className="rulebook-form-section rulebook-form-final" aria-labelledby={`save-${data.id}`}>
          <header>
            <span>3</span>
            <div><h3 id={`save-${data.id}`}>ยืนยันการเปลี่ยนแปลง</h3><p>ระบุเหตุผลทุกครั้งเพื่อให้ตรวจสอบย้อนหลังได้</p></div>
          </header>
          <div className="rulebook-form-grid">
            <label className="rulebook-toggle-field">
              <input type="checkbox" name="isActive" defaultChecked={data.isActive} />
              <span><strong>เปิดให้ใช้ในบิลใหม่</strong><small>ปิดสวิตช์เพื่อซ่อนประเภทนี้จากหน้าสร้างบิล โดยบิลเดิมไม่เปลี่ยน</small></span>
            </label>
            <label className="rulebook-field rulebook-field-wide">
              <span>เหตุผลที่แก้ไข <b aria-hidden="true">*</b></span>
              <small>ตัวอย่าง: “ปรับอัตราจ่ายตามประกาศวันที่ 10 พ.ย.” ข้อความนี้จะอยู่ใน Audit Log</small>
              <input name="reason" required maxLength={200} placeholder="พิมพ์เหตุผลก่อนบันทึก" />
            </label>
          </div>
          <footer className="rulebook-form-actions">
            <div>
              {data.usedInItems > 0 && <span className="muted">มีบิลเดิมล็อกค่านี้แล้ว {data.usedInItems.toLocaleString("th-TH")} รายการ</span>}
              <small>การบันทึกมีผลกับบิลใหม่เท่านั้น ไม่ย้อนแก้บิลที่ยืนยันแล้ว</small>
            </div>
            <button type="submit" disabled={pending}>
              {pending ? "กำลังบันทึก..." : "บันทึกการเปลี่ยนแปลง"}
            </button>
          </footer>
          {state.error !== null && <p className="error rulebook-form-message" role="alert">{state.error}</p>}
          {state.message !== null && <p className="success rulebook-form-message" role="status">✓ {state.message}</p>}
        </section>
      </form>
    </details>
  );
}

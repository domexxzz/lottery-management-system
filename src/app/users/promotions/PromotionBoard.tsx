"use client";

import { useActionState, useMemo, useState } from "react";
import { DatePicker } from "@/components/calendar";
import { PROMOTION_STATE_LABEL, type PromotionState } from "@/lib/agents/commission";
import { applyPromotionAction, clearPromotionAction, type UserActionState } from "../actions";

const INITIAL: UserActionState = { error: null, ok: false };
const MONEY = new Intl.NumberFormat("th-TH", { maximumFractionDigits: 0 });
const TONE: Record<PromotionState, string> = {
  NONE: "muted",
  SCHEDULED: "info",
  ACTIVE: "success",
  ENDING_SOON: "warning",
  EXPIRED: "danger",
};

export type PromotionBoardRow = {
  agentId: string;
  userId: string | null;
  code: string;
  name: string;
  suspended: boolean;
  commissionRate: string;
  laoCommissionRate: string;
  state: PromotionState;
  startsOn: string | null;
  endsOn: string | null;
  daysLeft: number | null;
  thaiMinGross: string | null;
  thaiRate: string | null;
  laoMinGross: string | null;
  laoRate: string | null;
};

function targetText(minGross: string | null, rate: string | null) {
  if (!minGross || !rate) return "—";
  return `${MONEY.format(Number(minGross))} → ${Number(rate).toFixed(0)}%`;
}

function timingText(row: PromotionBoardRow) {
  if (row.state === "NONE") return "ใช้อัตราปกติ";
  if (row.state === "SCHEDULED") return `เริ่ม ${row.startsOn}`;
  if (row.state === "EXPIRED") return `หมดอายุ ${row.endsOn}`;
  if (row.daysLeft === 0) return `วันนี้วันสุดท้าย (${row.endsOn})`;
  return `เหลือ ${row.daysLeft} วัน · ถึง ${row.endsOn}`;
}

/**
 * หน้าจัดการโปรโมชั่นค่าคอมทั้งองค์กร
 *
 * รวมสามเรื่องที่เดิมต้องเปิดหน้าแก้ไข Agent ทีละคนถึงจะรู้หรือทำได้
 *   1. ใครได้โปรโมชั่นอยู่บ้าง และเกณฑ์เท่าไหร่
 *   2. อันไหนใกล้หมดอายุหรือหมดไปแล้ว
 *   3. ตั้งชุดเดียวให้หลายคนพร้อมกัน โดยไม่ต้องกรอกหกช่องซ้ำทุกคน
 *
 * การแก้ทีละคนยังอยู่ที่หน้าแก้ไขผู้ใช้เหมือนเดิม หน้านี้ไม่ได้มาแทน
 */
export function PromotionBoard({ rows }: { rows: PromotionBoardRow[] }) {
  const [applyState, applyAction, applying] = useActionState(applyPromotionAction, INITIAL);
  const [clearState, clearAction, clearing] = useActionState(clearPromotionAction, INITIAL);
  const [selected, setSelected] = useState<string[]>([]);

  const withPromotion = rows.filter((row) => row.state !== "NONE");
  const needsAttention = rows.filter((row) => row.state === "ENDING_SOON" || row.state === "EXPIRED");
  const allSelected = rows.length > 0 && selected.length === rows.length;
  const selectedRows = useMemo(() => rows.filter((row) => selected.includes(row.agentId)), [rows, selected]);
  const overwriting = selectedRows.filter((row) => row.state !== "NONE").length;

  const toggle = (agentId: string) =>
    setSelected((current) => current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId]);
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((row) => row.agentId));
  const selectWithPromotion = () => setSelected(withPromotion.map((row) => row.agentId));

  const message = applyState.message ?? clearState.message;
  const error = applyState.error ?? clearState.error;
  const busy = applying || clearing;

  return <div className="promotion-board">
    {needsAttention.length > 0 && (
      <section className="promotion-alert" role="status" aria-labelledby="promotion-alert-heading">
        <h2 id="promotion-alert-heading">โปรโมชั่นที่ต้องตัดสินใจ {needsAttention.length} รายการ</h2>
        <p>ถ้าปล่อยไว้ อัตราจะกลับไปเป็นปกติโดยที่ Agent ไม่รู้ตัว แล้วจะมาถามตอนรอบจ่ายค่าคอม</p>
        <ul>
          {needsAttention.map((row) => (
            <li key={row.agentId}>
              <span className={`promotion-badge ${TONE[row.state]}`}>{PROMOTION_STATE_LABEL[row.state]}</span>
              <strong>{row.code} · {row.name}</strong>
              <small>{timingText(row)}</small>
            </li>
          ))}
        </ul>
      </section>
    )}

    <section className="promotion-bulk" aria-labelledby="promotion-bulk-heading">
      <header>
        <div>
          <p className="eyebrow">Bulk Campaign</p>
          <h2 id="promotion-bulk-heading">ตั้งโปรโมชั่นพร้อมกันหลายคน</h2>
          <p>กรอกเกณฑ์ชุดเดียว แล้วเลือกว่าจะให้ใครบ้าง · ค่าที่ตั้งจะทับโปรโมชั่นเดิมของคนที่เลือก</p>
        </div>
        <span className="promotion-selected-count">เลือกแล้ว <b>{selected.length}</b> / {rows.length}</span>
      </header>

      {message && <p className="promotion-ok" role="status">✓ {message}</p>}
      {error && <p className="promotion-error" role="alert">{error}</p>}

      <form action={applyAction} className="promotion-form">
        {selected.map((agentId) => <input key={agentId} type="hidden" name="agentIds" value={agentId} />)}
        <div className="promotion-form-grid">
          <div className="promotion-field">
            <label htmlFor="bulk-promotion-start">วันเริ่ม</label>
            <DatePicker id="bulk-promotion-start" name="commissionPromotionStartsOn" placeholder="เลือกวันเริ่ม" ariaLabel="เลือกวันเริ่มโปรโมชั่น" />
            <small>ดูจากวันออกรางวัลของงวด นับรวมวันเริ่ม</small>
          </div>
          <div className="promotion-field">
            <label htmlFor="bulk-promotion-end">วันสิ้นสุด</label>
            <DatePicker id="bulk-promotion-end" name="commissionPromotionEndsOn" placeholder="เลือกวันสิ้นสุด" ariaLabel="เลือกวันสิ้นสุดโปรโมชั่น" />
            <small>นับรวมวันสิ้นสุด</small>
          </div>
          <label className="promotion-field">ยอดขั้นต่ำหวยรัฐบาลต่องวด
            <input name="commissionPromotionThaiMinGross" type="number" min="0.01" step="0.01" placeholder="เช่น 20000" />
            <small>เว้นว่างทั้งคู่ = ไม่ตั้งโปรฯ หวยรัฐบาล</small>
          </label>
          <label className="promotion-field">ค่าคอมโปรฯ หวยรัฐบาล (%)
            <input name="commissionPromotionThaiRate" type="number" min="0" max="100" step="0.0001" placeholder="เช่น 32" />
            <small>ใช้เมื่อยอดหวยรัฐบาลของงวดถึงเกณฑ์</small>
          </label>
          <label className="promotion-field">ยอดขั้นต่ำหวยลาว Family ต่องวด
            <input name="commissionPromotionLaoMinGross" type="number" min="0.01" step="0.01" placeholder="เช่น 15000" />
            <small>หวยลาวและหวยลาวชุดนับแยกกันทีละงวด</small>
          </label>
          <label className="promotion-field">ค่าคอมโปรฯ หวยลาว Family (%)
            <input name="commissionPromotionLaoRate" type="number" min="0" max="100" step="0.0001" placeholder="เช่น 30" />
            <small>ใช้อัตราเดียวกันทั้งหวยลาวและหวยลาวชุด</small>
          </label>
        </div>
        <footer className="promotion-form-actions">
          {overwriting > 0 && <small className="promotion-overwrite-warning">มี {overwriting} คนที่มีโปรโมชั่นอยู่แล้ว การบันทึกจะทับของเดิม</small>}
          <button type="submit" className="promotion-apply" disabled={busy || selected.length === 0}>
            {applying ? "กำลังบันทึก…" : `ตั้งโปรโมชั่นให้ ${selected.length} คน`}
          </button>
        </footer>
      </form>

      <form action={clearAction} className="promotion-clear-form">
        {selected.map((agentId) => <input key={agentId} type="hidden" name="agentIds" value={agentId} />)}
        <button type="submit" className="promotion-clear" disabled={busy || selected.length === 0}>
          {clearing ? "กำลังล้าง…" : `ล้างโปรโมชั่นของ ${selected.length} คน`}
        </button>
        <small>กลับไปใช้อัตราปกติของแต่ละคน ไม่กระทบงวดที่ปิดบัญชีไปแล้ว</small>
      </form>
    </section>

    <section className="promotion-list" aria-labelledby="promotion-list-heading">
      <header>
        <div>
          <p className="eyebrow">Agent Promotions</p>
          <h2 id="promotion-list-heading">ใครได้โปรโมชั่นอยู่บ้าง</h2>
        </div>
        <div className="promotion-list-actions">
          <button type="button" onClick={toggleAll}>{allSelected ? "ไม่เลือกเลย" : "เลือกทุกคน"}</button>
          <button type="button" onClick={selectWithPromotion} disabled={withPromotion.length === 0}>เลือกเฉพาะคนที่มีโปรฯ ({withPromotion.length})</button>
        </div>
      </header>

      {rows.length === 0 ? <p className="empty-state">ยังไม่มี Agent ในระบบ</p> : <div className="promotion-table-wrap"><table>
        <thead><tr>
          <th scope="col"><span className="sr-only">เลือก</span></th>
          <th scope="col">Agent</th>
          <th scope="col">สถานะโปรฯ</th>
          <th scope="col">ช่วงเวลา</th>
          <th scope="col">หวยรัฐบาล</th>
          <th scope="col">หวยลาว Family</th>
          <th scope="col">อัตราปกติ</th>
          <th scope="col"><span className="sr-only">แก้ไข</span></th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.agentId} className={selected.includes(row.agentId) ? "is-selected" : undefined}>
          <td><input type="checkbox" checked={selected.includes(row.agentId)} onChange={() => toggle(row.agentId)} aria-label={`เลือก ${row.code} ${row.name}`} /></td>
          <td data-label="Agent"><strong>{row.code}</strong><small>{row.name}{row.suspended ? " · ระงับอยู่" : ""}</small></td>
          <td data-label="สถานะโปรฯ"><span className={`promotion-badge ${TONE[row.state]}`}>{PROMOTION_STATE_LABEL[row.state]}</span></td>
          <td data-label="ช่วงเวลา"><small>{timingText(row)}</small></td>
          <td data-label="หวยรัฐบาล" className="num">{targetText(row.thaiMinGross, row.thaiRate)}</td>
          <td data-label="หวยลาว Family" className="num">{targetText(row.laoMinGross, row.laoRate)}</td>
          <td data-label="อัตราปกติ" className="num"><small>ไทย {Number(row.commissionRate).toFixed(0)}% · ลาว {Number(row.laoCommissionRate).toFixed(0)}%</small></td>
          <td>{row.userId ? <a className="promotion-edit-link" href={`/users/${row.userId}/edit`}>แก้ทีละคน</a> : <small>ไม่มีบัญชีผู้ใช้</small>}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </div>;
}

"use client";

import { useActionState, useState } from "react";
import { laoBreakdown, laoResultProblem } from "@/lib/lao/rules";
import {
  enterLaoResultAction,
  removeCapOverrideAction,
  setCapOverrideAction,
  type ActionState,
} from "./actions";
import "./lao-forms.css";

const INITIAL: ActionState = { error: null, message: null };

function Feedback({ state }: { state: ActionState }) {
  return (
    <>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.message && <p className="success" role="status">{state.message}</p>}
    </>
  );
}

/**
 * ลงผลหวยลาว: กรอกเลขที่ออกเต็ม (เช่น 489441) ระบบแยกให้ดูก่อนบันทึก
 * แอดมินตรวจว่าถูกแล้วค่อยกดบันทึก ระบบบันทึกให้ทั้งหวยลาวและหวยลาวชุดของวันเดียวกัน
 */
export function LaoResultForm({ drawId }: { drawId: string }) {
  const [state, action, pending] = useActionState(enterLaoResultAction, INITIAL);
  const [value, setValue] = useState("");
  const problem = value ? laoResultProblem(value) : null;
  const parts = value && !problem ? laoBreakdown(value) : null;

  return (
    <form action={action} className="lao-result-form" onSubmit={(event) => {
      if (!parts || !window.confirm(`ยืนยันผลหวยลาว ${value} ใช่ไหม?\n4 ตัว ${parts.last4} · 3 ตัวท้าย ${parts.last3} · 3 ตัวหน้า ${parts.first3} · 2 ตัวบน ${parts.last2} · 2 ตัวล่าง ${parts.first2}`)) {
        event.preventDefault();
      }
    }}>
      <input type="hidden" name="drawId" value={drawId} />
      <label>
        เลขที่ออก (6 หลัก)
        <input
          name="officialNumber"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          value={value}
          onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
          placeholder="เช่น 489441"
          required
          autoComplete="off"
        />
      </label>
      {problem && <p className="error">{problem}</p>}
      <div className="lao-result-preview" aria-live="polite">
        <p>{parts ? "ระบบใช้ 4 ตัวท้าย ตรวจให้ถูกก่อนบันทึก" : "กรอกเลขแล้วระบบจะแยกให้ดูตรงนี้"}</p>
        <dl>
          <div><dt>4 ตัว</dt><dd>{parts?.last4 ?? "—"}</dd></div>
          <div><dt>3 ตัวท้าย / 3 ตัวตรง</dt><dd>{parts?.last3 ?? "—"}</dd></div>
          <div><dt>3 ตัวหน้า</dt><dd>{parts?.first3 ?? "—"}</dd></div>
          <div><dt>2 ตัวบน / 2 ตัวหลัง</dt><dd>{parts?.last2 ?? "—"}</dd></div>
          <div><dt>2 ตัวล่าง / 2 ตัวหน้า</dt><dd>{parts?.first2 ?? "—"}</dd></div>
        </dl>
        <small>โต๊ดใช้เลขชุดเดียวกัน สลับตำแหน่งได้ทุกแบบ</small>
      </div>
      <button type="submit" disabled={pending || !parts}>{pending ? "กำลังบันทึกและคำนวณ..." : "✓ บันทึกผลและคำนวณ (หวยลาว + หวยลาวชุด)"}</button>
      <Feedback state={state} />
    </form>
  );
}

export type LaoPrizeOption = { id: string; code: number; name: string; digits: number };

export type CapOverrideRow = { id: string; number: string; cap: string; prizeTypeName: string };

function RemoveOverrideButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(removeCapOverrideAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="overrideId" value={id} />
      <button type="submit" className="secondary-button" disabled={pending}>{pending ? "…" : "ใช้เพดานงวด"}</button>
      {state.error && <small className="error">{state.error}</small>}
    </form>
  );
}

/** Owner ตั้งเพดานเฉพาะเลข: ปลดเลขที่เต็มแล้ว (เพิ่มเพดาน) หรือลดเพดานเลขเสี่ยง */
export function CapOverrideManager({ drawId, editable, capLabel, prizeTypes, rows }: { drawId: string; editable: boolean; capLabel: string; prizeTypes: LaoPrizeOption[]; rows: CapOverrideRow[] }) {
  const [state, action, pending] = useActionState(setCapOverrideAction, INITIAL);
  const [prizeTypeId, setPrizeTypeId] = useState(prizeTypes[0]?.id ?? "");
  const selected = prizeTypes.find((prizeType) => prizeType.id === prizeTypeId);
  return (
    <section className="cap-override-manager" aria-labelledby="cap-override-heading">
      <header>
        <h2 id="cap-override-heading">เพดานเฉพาะเลข</h2>
        <span>เพดานทั้งงวดเลขละ {capLabel} · ตั้งเลขไหนต่างจากนี้ได้ เช่น ปลดเลขที่เต็มแล้ว หรือลดเพดานเลขเสี่ยง</span>
      </header>
      {editable && (
        <form action={action} className="cap-override-form">
          <input type="hidden" name="drawId" value={drawId} />
          <label>
            ประเภท
            <select name="prizeTypeId" value={prizeTypeId} onChange={(event) => setPrizeTypeId(event.target.value)}>
              {prizeTypes.map((prizeType) => <option key={prizeType.id} value={prizeType.id}>{prizeType.name}</option>)}
            </select>
          </label>
          <label>
            เลข
            <input name="number" inputMode="numeric" maxLength={selected?.digits ?? 6} placeholder={"0".repeat(selected?.digits ?? 3)} required autoComplete="off" />
          </label>
          <label>
            เพดานเลขนี้ (บาท)
            <input name="cap" inputMode="decimal" placeholder="เช่น 5000" required />
          </label>
          <button type="submit" disabled={pending}>{pending ? "กำลังบันทึก..." : "บันทึกเพดาน"}</button>
          <Feedback state={state} />
        </form>
      )}
      {rows.length === 0 ? <p className="muted">ยังไม่มีเลขที่ตั้งเพดานเฉพาะ ทุกเลขใช้เพดานทั้งงวด</p> : (
        <table>
          <thead><tr><th scope="col">เลข</th><th scope="col" className="num">เพดาน (บาท)</th>{editable && <th scope="col"><span className="sr-only">จัดการ</span></th>}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td><strong>{row.number}</strong><small>{row.prizeTypeName}</small></td>
                <td className="num"><strong>{row.cap}</strong></td>
                {editable && <td><RemoveOverrideButton id={row.id} /></td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

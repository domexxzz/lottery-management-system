"use client";

import { useActionState, useEffect } from "react";
import {
  confirmBillAction,
  deleteBillItemAction,
  deleteBillAction,
  updateBillItemAction,
  updateBillAction,
  type ActionState,
} from "../actions";

const INITIAL: ActionState = { error: null };

export type InlineEditableItem = {
  billId: string;
  itemId: string;
  number: string;
  digits: number;
  unitStake: number;
  quantity: number;
  packageLabel: string | null;
};

export function DeleteBillItemButton({ billId, itemId, label }: { billId: string; itemId: string; label: string }) {
  const [state, action, pending] = useActionState(deleteBillItemAction, INITIAL);
  return (
    <form className="slip-card-delete-form" action={action} onSubmit={(event) => {
      if (!window.confirm(`ลบเฉพาะรายการ ${label} ออกจากบิลใช่ไหม? ยอดบิลจะคำนวณใหม่ทันที`)) event.preventDefault();
    }}>
      <input type="hidden" name="billId" value={billId} />
      <input type="hidden" name="itemId" value={itemId} />
      <button type="submit" className="slip-card-action is-delete" disabled={pending} aria-label={`ลบ ${label}`}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6m4 4v6m6-6v6" /></svg>
        {pending ? "กำลังลบ" : "ลบ"}
      </button>
      {state.error && <small className="slip-card-action-error" role="alert">{state.error}</small>}
    </form>
  );
}

export function InlineEditBillItemForm({ item, onClose }: { item: InlineEditableItem; onClose: () => void }) {
  const [state, action, pending] = useActionState(updateBillItemAction, INITIAL);
  useEffect(() => { if (state.saved) onClose(); }, [state.saved, onClose]);
  return (
    <form className="slip-card-inline-edit" action={action}>
      <input type="hidden" name="billId" value={item.billId} />
      <input type="hidden" name="itemId" value={item.itemId} />
      <label>เลขที่ซื้อ<input name="number" defaultValue={item.number} inputMode="numeric" pattern={`\\d{${item.digits}}`} maxLength={item.digits} required /></label>
      {item.packageLabel ? (
        <>
          <label>ราคาชุด<input value={item.packageLabel} disabled /><input type="hidden" name="stake" value={item.unitStake} /></label>
          <label>จำนวนชุด<input name="quantity" type="number" defaultValue={item.quantity} min="1" max="999" step="1" required /></label>
        </>
      ) : (
        <><label>ยอดเดิมพัน<input name="stake" type="number" defaultValue={item.unitStake} min="1" max="1000" step="1" required /></label><input type="hidden" name="quantity" value="1" /></>
      )}
      <div className="slip-card-inline-edit-actions">
        <button type="button" className="is-cancel" onClick={onClose} disabled={pending}>ยกเลิก</button>
        <button type="submit" className="is-save" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
      </div>
      {state.error && <p className="slip-card-action-error" role="alert">{state.error}</p>}
    </form>
  );
}

export function ConfirmButton({ billId, evidenceReady, evidenceMessage }: { billId: string; evidenceReady: boolean; evidenceMessage: string }) {
  const [state, formAction, pending] = useActionState(confirmBillAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="billId" value={billId} />
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {!evidenceReady && <p className="notice">{evidenceMessage}</p>}
      <button type="submit" disabled={pending || !evidenceReady}>
        {pending ? "กำลังยืนยัน..." : "ยืนยันบิล"}
      </button>
    </form>
  );
}

export function DeleteBillForm({ billId, billLabel, attachmentCount }: { billId: string; billLabel: string; attachmentCount: number }) {
  const [state, formAction, pending] = useActionState(deleteBillAction, INITIAL);

  return (
    <form className="delete-bill-form" action={formAction} onSubmit={(event) => {
      const evidence = attachmentCount > 0 ? ` (หลักฐาน ${attachmentCount} ไฟล์จะยังเก็บในประวัติ)` : "";
      if (!window.confirm(`ยืนยันลบ${billLabel}ใช่ไหม?${evidence} บิลจะไม่ถูกนำไปคำนวณ แต่ยังตรวจสอบประวัติได้`)) event.preventDefault();
    }}>
      <input type="hidden" name="billId" value={billId} />
      {state.error !== null && <p className="error" role="alert">{state.error}</p>}
      <p className="notice">บิลจะหายจากรายการที่ใช้งานและไม่ถูกนำไปคำนวณ แต่เลขเดิมพัน หลักฐาน ผู้ลบ เวลา และประวัติยังคงอยู่</p>
      <button type="submit" className="danger-button" disabled={pending}>
        {pending ? "กำลังลบบิล..." : "ลบบิล"}
      </button>
    </form>
  );
}

type EditableItem = { id: string; prizeTypeId: string; prizeTypeName: string; number: string; stake: string; quantity: number; digits: number; packageLabel?: string | null; lockedStake?: boolean };

export function EditBillForm({ billId, title, items }: { billId: string; title: string; items: EditableItem[] }) {
  const [state, formAction, pending] = useActionState(updateBillAction, INITIAL);
  return (
    <form className="bill-edit-form" action={formAction}>
      <input type="hidden" name="billId" value={billId} />
      <label className="bill-edit-title">ชื่อลูกค้า<input name="title" defaultValue={title} required maxLength={120} /></label>
      <div className="bill-edit-rows">
        {items.map((item, index) => (
          <fieldset key={item.id}>
            <legend>รายการ {index + 1} · {item.prizeTypeName}{item.packageLabel ? ` · ${item.packageLabel}` : ""}</legend>
            <input type="hidden" name="prizeTypeId" value={item.prizeTypeId} />
            <label>เลขที่แทง<input name="number" defaultValue={item.number} inputMode="numeric" pattern={`\\d{${item.digits}}`} maxLength={item.digits} required /></label>
            {item.lockedStake ? (
              <><label>ประเภทชุด<input value={item.packageLabel ?? `${item.stake} บาท`} disabled aria-label={`ประเภทชุด ${item.packageLabel ?? item.stake}`} /><input type="hidden" name="stake" value={item.stake} /></label><label>จำนวนชุด<input name="quantity" type="number" defaultValue={item.quantity} min="1" max="999" step="1" required /></label></>
            ) : (
              <label>ยอดเดิมพัน (บาท)<input name="stake" type="number" defaultValue={item.stake} min="5" max="1000" step="1" required /><input type="hidden" name="quantity" value="1" /></label>
            )}
          </fieldset>
        ))}
      </div>
      <p className="notice">บันทึกแล้วมีผลทันที ระบบจะเก็บเลขและยอดเดิมพันก่อน–หลัง พร้อมชื่อผู้แก้และเวลาโดยอัตโนมัติ</p>
      {state.error !== null && <p className="error" role="alert">{state.error}</p>}
      {state.error === null && !pending && <p className="bill-edit-success" aria-live="polite">แก้เลขหรือยอดเดิมพัน แล้วกดบันทึกการแก้ไข</p>}
      <button type="submit" disabled={pending}>{pending ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}</button>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import {
  cancelBillAction,
  confirmBillAction,
  deleteBillAction,
  requestCancelAction,
  updateBillAction,
  type ActionState,
} from "../actions";

const INITIAL: ActionState = { error: null };

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

export function CancelForm({ billId, label }: { billId: string; label: string }) {
  const [state, formAction, pending] = useActionState(cancelBillAction, INITIAL);

  return (
    <form action={formAction} onSubmit={(event) => {
      if (!window.confirm("ยืนยันการยกเลิกบิลนี้ใช่ไหม?")) event.preventDefault();
    }}>
      <input type="hidden" name="billId" value={billId} />
      <label htmlFor="cancel-reason">
        เหตุผลในการยกเลิก
        <input id="cancel-reason" name="reason" required maxLength={200} />
      </label>
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="danger-button" disabled={pending}>
        {pending ? "กำลังดำเนินการ..." : label}
      </button>
    </form>
  );
}

/** Admin เสนอยกเลิกหลังปิดรับ แต่ยกเลิกเองไม่ได้ ต้องรอผู้มีอำนาจอนุมัติ */
export function RequestCancelForm({ billId }: { billId: string }) {
  const [state, formAction, pending] = useActionState(requestCancelAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="billId" value={billId} />
      <label htmlFor="request-reason">
        เหตุผลในการเสนอยกเลิก
        <input id="request-reason" name="reason" required maxLength={200} />
      </label>
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="danger-button" disabled={pending}>
        {pending ? "กำลังส่งคำขอ..." : "เสนอยกเลิกให้ผู้มีอำนาจอนุมัติ"}
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
      <p className="notice">บิลจะหายจากรายการที่ใช้งานและไม่ถูกนำไปคำนวณ แต่เลขเดิมพัน หลักฐาน และประวัติยังคงอยู่</p>
      <button type="submit" className="danger-button" disabled={pending}>
        {pending ? "กำลังลบบิล..." : "ลบบิล"}
      </button>
    </form>
  );
}

type EditableItem = { id: string; prizeTypeId: string; prizeTypeName: string; number: string; stake: string; digits: number };

export function EditBillForm({ billId, title, items }: { billId: string; title: string; items: EditableItem[] }) {
  const [state, formAction, pending] = useActionState(updateBillAction, INITIAL);
  return (
    <form className="bill-edit-form" action={formAction}>
      <input type="hidden" name="billId" value={billId} />
      <label className="bill-edit-title">ชื่อลูกค้า<input name="title" defaultValue={title} required maxLength={120} /></label>
      <div className="bill-edit-rows">
        {items.map((item, index) => (
          <fieldset key={item.id}>
            <legend>รายการ {index + 1} · {item.prizeTypeName}</legend>
            <input type="hidden" name="prizeTypeId" value={item.prizeTypeId} />
            <label>เลขที่แทง<input name="number" defaultValue={item.number} inputMode="numeric" pattern={`\\d{${item.digits}}`} maxLength={item.digits} required /></label>
            <label>ยอดเดิมพัน (บาท)<input name="stake" type="number" defaultValue={item.stake} min="5" max="1000" step="1" required /></label>
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

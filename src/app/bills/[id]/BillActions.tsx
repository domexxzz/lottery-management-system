"use client";

import { useActionState } from "react";
import {
  cancelBillAction,
  confirmBillAction,
  requestCancelAction,
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

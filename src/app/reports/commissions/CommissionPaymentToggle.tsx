"use client";

import { useActionState } from "react";
import { setCommissionPaidAction } from "./actions";

const INITIAL = { error: null, message: null };

export function CommissionPaymentToggle({
  agentId,
  month,
  payment,
}: {
  agentId: string;
  month: string;
  payment: null | { paidAtLabel: string; paidByName: string; snapshotTotal: number; difference: number };
}) {
  const [state, action, pending] = useActionState(setCommissionPaidAction, INITIAL);
  const paid = Boolean(payment);
  return <div className="commission-check-cell">
    <form action={action} onSubmit={(event) => {
      if (paid && !window.confirm("ยืนยันยกเลิกเครื่องหมายจ่ายค่าคอมรายการนี้? ประวัติเดิมจะยังถูกเก็บไว้")) event.preventDefault();
    }}>
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="month" value={month} />
      <button className={paid ? "is-paid" : "is-pending"} name="paid" value={paid ? "false" : "true"} disabled={pending}>
        <span aria-hidden="true">{paid ? "✓" : "○"}</span>
        {pending ? "กำลังบันทึก…" : paid ? "จ่ายแล้ว" : "ทำเครื่องหมายว่าจ่ายแล้ว"}
      </button>
    </form>
    {payment && <small>{payment.paidAtLabel} · {payment.paidByName}</small>}
    {payment && Math.abs(payment.difference) >= 0.01 && <small className="commission-changed">ยอดปัจจุบันเปลี่ยน {payment.difference > 0 ? "+" : "−"}{Math.abs(payment.difference).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</small>}
    {state.error && <small className="commission-action-error" role="alert">{state.error}</small>}
  </div>;
}

"use client";

import { useActionState } from "react";
import { cancelBillAction, confirmBillAction, type ActionState } from "../actions";

const INITIAL: ActionState = { error: null };

export function ConfirmButton({ billId }: { billId: string }) {
  const [state, formAction, pending] = useActionState(confirmBillAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="billId" value={billId} />
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "กำลังยืนยัน..." : "ยืนยันบิล"}
      </button>
    </form>
  );
}

export function CancelForm({ billId }: { billId: string }) {
  const [state, formAction, pending] = useActionState(cancelBillAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="billId" value={billId} />
      <label htmlFor="reason">
        เหตุผลในการยกเลิก
        <input id="reason" name="reason" required maxLength={200} />
      </label>
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "กำลังยกเลิก..." : "ยกเลิกบิล"}
      </button>
    </form>
  );
}

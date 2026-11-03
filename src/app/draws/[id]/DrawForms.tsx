"use client";

import { useActionState } from "react";
import {
  approveResultAction,
  approveSettlementAction,
  calculateSettlementAction,
  enterResultAction,
  reconcileAction,
  rejectResultAction,
  type ActionState,
} from "./actions";

const INITIAL: ActionState = { error: null, message: null };

function Feedback({ state }: { state: ActionState }) {
  return (
    <>
      {state.error !== null && (
        <span className="error" role="alert">
          {state.error}
        </span>
      )}
      {state.message !== null && <span role="status">{state.message}</span>}
    </>
  );
}

export function EnterResultForm({
  drawId,
  prizeTypeId,
  code,
  currentValue,
  hint,
}: {
  drawId: string;
  prizeTypeId: string;
  code: number;
  currentValue: string;
  hint: string;
}) {
  const [state, formAction, pending] = useActionState(enterResultAction, INITIAL);

  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="drawId" value={drawId} />
      <input type="hidden" name="prizeTypeId" value={prizeTypeId} />
      <input
        name="value"
        inputMode="numeric"
        defaultValue={currentValue}
        placeholder={hint}
        aria-label={`ผลรางวัลที่ ${code}`}
        required
      />
      <button type="submit" disabled={pending}>
        {pending ? "..." : "บันทึกผล"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ApproveResultForm({ drawId, resultId }: { drawId: string; resultId: string }) {
  const [state, formAction, pending] = useActionState(approveResultAction, INITIAL);

  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="drawId" value={drawId} />
      <input type="hidden" name="resultId" value={resultId} />
      <button type="submit" disabled={pending}>
        {pending ? "..." : "อนุมัติผล"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function RejectResultForm({ drawId, resultId }: { drawId: string; resultId: string }) {
  const [state, formAction, pending] = useActionState(rejectResultAction, INITIAL);

  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="drawId" value={drawId} />
      <input type="hidden" name="resultId" value={resultId} />
      <input name="reason" required maxLength={200} placeholder="เหตุผลที่ตีกลับ" />
      <button type="submit" disabled={pending}>
        {pending ? "..." : "ตีกลับ"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function CalculateForm({ drawId }: { drawId: string }) {
  const [state, formAction, pending] = useActionState(calculateSettlementAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="drawId" value={drawId} />
      <button type="submit" disabled={pending}>
        {pending ? "กำลังคำนวณ..." : "คำนวณ Settlement"}
      </button>
      <p className="muted">
        คำนวณซ้ำได้ ผลลัพธ์เท่าเดิมเสมอ เพราะอ่านอัตราจ่ายที่ล็อกไว้ตอนยืนยันบิล
      </p>
      <Feedback state={state} />
    </form>
  );
}

export function ReconcileForm({
  drawId,
  settlementId,
}: {
  drawId: string;
  settlementId: string;
}) {
  const [state, formAction, pending] = useActionState(reconcileAction, INITIAL);

  return (
    <form action={formAction} className="inline-form">
      <input type="hidden" name="drawId" value={drawId} />
      <input type="hidden" name="settlementId" value={settlementId} />
      <button type="submit" disabled={pending}>
        {pending ? "..." : "กระทบยอดแล้ว"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function ApproveSettlementForm({ drawId }: { drawId: string }) {
  const [state, formAction, pending] = useActionState(approveSettlementAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="drawId" value={drawId} />
      <button type="submit" disabled={pending}>
        {pending ? "กำลังปิดบัญชี..." : "อนุมัติและปิดบัญชีรอบ"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

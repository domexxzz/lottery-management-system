"use client";

import { useActionState } from "react";
import {
  approveResultAction,
  approveSettlementAction,
  calculateSettlementAction,
  enterResultAction,
  enterResultsBatchAction,
  proposeResultCorrectionAction,
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

export function SaveAllResultsForm({ drawId, formId, editableCount }: { drawId: string; formId: string; editableCount: number }) {
  const [state, formAction, pending] = useActionState(enterResultsBatchAction, INITIAL);
  return (
    <form id={formId} action={formAction} className="bulk-result-save-bar">
      <input type="hidden" name="drawId" value={drawId} />
      <div><strong>กรอกผลให้ครบแล้วบันทึกพร้อมกัน</strong><small>ระบบจะตรวจทุกแถวก่อน หากมีแถวผิดจะยังไม่บันทึกรายการใด</small></div>
      <button type="submit" disabled={pending || editableCount === 0}>
        {pending ? "กำลังบันทึก..." : `✓ บันทึกผลทั้งหมด (${editableCount})`}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function EnterResultForm({
  drawId,
  prizeTypeId,
  code,
  currentValue,
  hint,
  resultLength,
}: {
  drawId: string;
  prizeTypeId: string;
  code: number;
  currentValue: string;
  hint: string;
  /** ความยาวของผลที่ประกาศ ไม่ใช่ความยาวของเลขที่แทง (ดู expectedResultLength) */
  resultLength: number;
}) {
  const [state, formAction, pending] = useActionState(enterResultAction, INITIAL);

  return (
    <form action={formAction} className="inline-form result-entry-form">
      <input type="hidden" name="drawId" value={drawId} />
      <input type="hidden" name="prizeTypeId" value={prizeTypeId} />
      <input
        name="value"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={resultLength}
        defaultValue={currentValue}
        placeholder={`กรอกเลขที่ออก · ${hint}`}
        aria-label={`ผลรางวัลที่ ${code}`}
        required
      />
      <button type="submit" disabled={pending} className="result-save-button">
        {pending ? "กำลังบันทึก..." : "✓ บันทึกและยืนยันผล"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

/**
 * เสนอแก้ผลที่ประกาศไปแล้ว
 *
 * แยกจากช่องกรอกผลปกติโดยตั้งใจ เพราะเป็นคนละการกระทำ:
 * การกรอกผลจบในขั้นตอนเดียว ส่วนการแก้ต้องมีเหตุผลและรอคนที่สองอนุมัติ
 */
export function ProposeCorrectionForm({
  drawId,
  prizeTypeId,
  code,
  currentValues,
  resultLength,
  valueCount,
}: {
  drawId: string;
  prizeTypeId: string;
  code: number;
  currentValues: string[];
  resultLength: number;
  valueCount: number;
}) {
  const [state, formAction, pending] = useActionState(proposeResultCorrectionAction, INITIAL);

  return (
    <details className="result-correction">
      <summary>แก้ผลที่ประกาศแล้ว</summary>
      <form action={formAction} className="inline-form">
        <input type="hidden" name="drawId" value={drawId} />
        <input type="hidden" name="prizeTypeId" value={prizeTypeId} />
        <p className="muted">
          ผลปัจจุบันคือ {currentValues.join(" · ")} · ผลเดิมยังมีผลบังคับจนกว่า Owner จะอนุมัติการแก้
        </p>
        {Array.from({ length: valueCount }, (_, valueIndex) => (
          <input
            key={valueIndex}
            name="value"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={resultLength}
            placeholder={`ผลที่ถูกต้อง${valueCount > 1 ? ` ช่อง ${valueIndex + 1}` : ""} · ${resultLength} หลัก`}
            aria-label={`ผลที่ถูกต้องของรางวัลที่ ${code}${valueCount > 1 ? ` เลขที่ ${valueIndex + 1}` : ""}`}
            required
          />
        ))}
        <input
          name="reason"
          maxLength={200}
          placeholder="เหตุผลที่ต้องแก้"
          aria-label={`เหตุผลที่แก้ผลรางวัลที่ ${code}`}
          required
        />
        <button type="submit" disabled={pending}>
          {pending ? "กำลังส่ง..." : "ส่งคำขอแก้ผล"}
        </button>
        <Feedback state={state} />
      </form>
    </details>
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

export function ApproveSettlementForm({ drawId }: { drawId: string }) {
  const [state, formAction, pending] = useActionState(approveSettlementAction, INITIAL);

  return (
    <form action={formAction}>
      <input type="hidden" name="drawId" value={drawId} />
      <button type="submit" disabled={pending}>
        {pending ? "กำลังปิดบัญชี..." : "อนุมัติและปิดบัญชีงวด"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

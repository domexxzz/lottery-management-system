"use client";

import { useActionState } from "react";
import { createDrawAction, lockDrawAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, message: null };

export function CreateDrawForm() {
  const [state, formAction, pending] = useActionState(createDrawAction, INITIAL);

  return (
    <form action={formAction}>
      <label htmlFor="name">
        ชื่อรอบ
        <input id="name" name="name" required maxLength={120} placeholder="งวด 16 พ.ย. 2569" />
      </label>

      <label htmlFor="opensAt">
        เวลาเปิดรับ
        <input id="opensAt" name="opensAt" type="datetime-local" required />
      </label>

      <label htmlFor="cutoffAt">
        เวลาปิดรับ (Cutoff)
        <input id="cutoffAt" name="cutoffAt" type="datetime-local" required />
      </label>

      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message !== null && <p role="status">{state.message}</p>}

      <button type="submit" disabled={pending}>
        {pending ? "กำลังบันทึก..." : "สร้างรอบ"}
      </button>
    </form>
  );
}

export function LockDrawForm({ drawId }: { drawId: string }) {
  const [state, formAction, pending] = useActionState(lockDrawAction, INITIAL);

  return (
    <form action={formAction} onSubmit={(event) => {
      if (!window.confirm("ปิดรับรอบนี้และยกเลิกบิลร่างที่ค้างอยู่ใช่ไหม?")) event.preventDefault();
    }}>
      <input type="hidden" name="drawId" value={drawId} />
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message !== null && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "กำลังปิดรอบ..." : "ปิดรอบตอนนี้"}
      </button>
    </form>
  );
}

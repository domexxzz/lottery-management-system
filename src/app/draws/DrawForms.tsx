"use client";

import { useActionState, useState } from "react";
import { officialDrawName } from "@/lib/draws/schedule";
import { createDrawAction, lockDrawAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, message: null };

export function CreateDrawForm() {
  const [state, formAction, pending] = useActionState(createDrawAction, INITIAL);
  const [cutoffAt, setCutoffAt] = useState("");
  const drawName = officialDrawName(cutoffAt);

  return (
    <form action={formAction}>
      <label htmlFor="opensAt">
        เวลาเปิดรับ
        <input id="opensAt" name="opensAt" type="datetime-local" required />
      </label>

      <label htmlFor="cutoffAt">
        วันที่และเวลาปิดรับ (ใช้เป็นชื่องวด)
        <input id="cutoffAt" name="cutoffAt" type="datetime-local" value={cutoffAt} onChange={(event) => setCutoffAt(event.target.value)} required />
      </label>

      <p className="draw-name-preview" role="status">
        ชื่องวด: <strong>{drawName ?? "เลือกวันที่ปิดรับ"}</strong>
        <span>ระบบกำหนดงวดเฉพาะวันที่ 1 และ 16</span>
      </p>

      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message !== null && <p role="status">{state.message}</p>}

      <button type="submit" disabled={pending}>
        {pending ? "กำลังบันทึก..." : "สร้างงวด"}
      </button>
    </form>
  );
}

export function LockDrawForm({ drawId }: { drawId: string }) {
  const [state, formAction, pending] = useActionState(lockDrawAction, INITIAL);

  return (
    <form action={formAction} onSubmit={(event) => {
      if (!window.confirm("ปิดรับงวดนี้และยกเลิกบิลร่างที่ค้างอยู่ใช่ไหม?")) event.preventDefault();
    }}>
      <input type="hidden" name="drawId" value={drawId} />
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message !== null && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "กำลังปิดงวด..." : "ปิดงวดตอนนี้"}
      </button>
    </form>
  );
}

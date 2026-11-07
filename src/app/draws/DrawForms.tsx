"use client";

import { useActionState, useState } from "react";
import { defaultOfficialDrawWindow, officialDrawName, toBangkokDateTimeLocal } from "@/lib/draws/schedule";
import { AppDropdown } from "../AppDropdown";
import { createDrawAction, lockDrawAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, message: null };

function defaultWindow(drawDate: string) {
  const window = defaultOfficialDrawWindow(drawDate);
  return {
    opensAt: window ? toBangkokDateTimeLocal(window.opensAt) : "",
    cutoffAt: window ? toBangkokDateTimeLocal(window.cutoffAt) : "",
  };
}

export function CreateDrawForm({ drawDates }: { drawDates: string[] }) {
  const [state, formAction, pending] = useActionState(createDrawAction, INITIAL);
  const [drawDate, setDrawDate] = useState(drawDates[0] ?? "");
  const initialWindow = defaultWindow(drawDates[0] ?? "");
  const [opensAt, setOpensAt] = useState(initialWindow.opensAt);
  const [cutoffAt, setCutoffAt] = useState(initialWindow.cutoffAt);
  const drawName = officialDrawName(drawDate);

  return (
    <form action={formAction}>
      <label htmlFor="drawDate">
        เลือกงวดที่จะเปิด
        <AppDropdown
          id="drawDate"
          name="drawDate"
          value={drawDate}
          onValueChange={(value) => {
            const window = defaultWindow(value);
            setDrawDate(value);
            setOpensAt(window.opensAt);
            setCutoffAt(window.cutoffAt);
          }}
          required
          options={drawDates.map((date) => ({
            value: date,
            label: officialDrawName(date) ?? date,
            description: "เปิดก่อน 5 วัน · ปิดก่อน 1 วัน เวลา 14:00 น.",
          }))}
        />
      </label>

      <label htmlFor="opensAt">
        วันเวลาเปิดรับ
        <input id="opensAt" name="opensAt" type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} required />
      </label>

      <label htmlFor="cutoffAt">
        วันเวลาปิดรับ
        <input id="cutoffAt" name="cutoffAt" type="datetime-local" value={cutoffAt} onChange={(event) => setCutoffAt(event.target.value)} required />
      </label>

      <p className="draw-name-preview" role="status">
        ชื่องวด: <strong>{drawName ?? "ยังไม่มีงวดที่เปิดได้"}</strong>
        <span>เปิดก่อนงวด 5 วัน · ปิดก่อนงวด 1 วัน เวลา 14:00 น. · แก้ไขได้</span>
      </p>

      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message !== null && <p role="status">{state.message}</p>}

      <button type="submit" disabled={pending || !drawDate || !opensAt || !cutoffAt}>
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

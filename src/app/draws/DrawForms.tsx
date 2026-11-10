"use client";

import { useActionState, useState } from "react";
import { defaultOfficialDrawWindow, officialDrawName, parseBangkokDateTimeLocal, toBangkokDateTimeLocal } from "@/lib/draws/schedule";
import { AppDropdown } from "../AppDropdown";
import { createDrawAction, deleteDrawAction, lockDrawAction, type ActionState } from "./actions";
import { DateTimePicker } from "@/components/calendar";

const INITIAL: ActionState = { error: null, message: null };
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

function defaultWindow(drawDate: string) {
  const window = defaultOfficialDrawWindow(drawDate);
  return {
    opensAt: window ? toBangkokDateTimeLocal(window.opensAt) : "",
    cutoffAt: window ? toBangkokDateTimeLocal(window.cutoffAt) : "",
  };
}

function displayDateTime(value: string) {
  const date = parseBangkokDateTimeLocal(value);
  return date ? `${DATE_TIME.format(date)} น.` : "ยังไม่ได้กำหนด";
}

export function CreateDrawForm({ drawDates, automaticDrawDate, createdDrawDates }: { drawDates: string[]; automaticDrawDate: string; createdDrawDates: string[] }) {
  const [state, formAction, pending] = useActionState(createDrawAction, INITIAL);
  const [drawDate, setDrawDate] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [cutoffAt, setCutoffAt] = useState("");
  const [prepared, setPrepared] = useState(false);
  const drawName = officialDrawName(drawDate);
  const createdDrawDateSet = new Set(createdDrawDates);
  const isDuplicate = createdDrawDateSet.has(drawDate);

  function applyAutomaticSchedule() {
    const automaticDate = automaticDrawDate;
    const window = defaultWindow(automaticDate);
    setDrawDate(automaticDate);
    setOpensAt(window.opensAt);
    setCutoffAt(window.cutoffAt);
    setPrepared(Boolean(automaticDate && window.opensAt && window.cutoffAt));
  }

  return (
    <form action={formAction} onSubmit={(event) => {
      if (isDuplicate && !window.confirm(`งวด ${drawName ?? drawDate} เคยถูกสร้างแล้ว ต้องการสร้างซ้ำหรือไม่?`)) {
        event.preventDefault();
      }
    }}>
      <input type="hidden" name="drawDate" value={drawDate} />
      <input type="hidden" name="opensAt" value={opensAt} />
      <input type="hidden" name="cutoffAt" value={cutoffAt} />

      <div className="draw-create-toolbar" aria-label="วิธีตั้งค่างวด">
        <button type="button" className={prepared ? "active" : ""} onClick={applyAutomaticSchedule}>สร้างอัตโนมัติ</button>
      </div>

      {!prepared && <div className="draw-create-empty" aria-live="polite"><strong>ยังไม่ได้เตรียมข้อมูลงวด</strong><span>กด “สร้างอัตโนมัติ” เพื่อให้ระบบคำนวณงวดและเวลา แล้วตรวจสอบก่อนยืนยัน</span></div>}

      {prepared && <section className="draw-schedule-preview" aria-label="ข้อมูลก่อนสร้างงวด" aria-live="polite">
        <div><span>งวดที่จะสร้าง</span><strong>{drawName ?? "ยังไม่มีงวดที่เปิดได้"}</strong><small>เลือกอัตโนมัติตามวันที่ปัจจุบัน</small></div>
        <div><span>วันเวลาเปิดรับ</span><strong>{displayDateTime(opensAt)}</strong><small>ก่อนวันงวด 5 วัน</small></div>
        <div><span>วันเวลาปิดรับ</span><strong>{displayDateTime(cutoffAt)}</strong><small>ก่อนวันงวด 1 วัน เวลา 14:00 น.</small></div>
      </section>}

      {prepared && <section className="draw-manual-settings" aria-label="แก้ไขงวดและวันเวลา">
        <p className="draw-edit-hint"><strong>แก้ไขข้อมูลก่อนยืนยัน</strong><span>สามารถเปลี่ยนงวด วันเวลาเปิดรับ และวันเวลาปิดรับได้</span></p>
        <label htmlFor="drawDate">เลือกงวดที่จะเปิด<AppDropdown id="drawDate" value={drawDate} onValueChange={(value) => {
          const window = defaultWindow(value);
          setDrawDate(value);
          setOpensAt(window.opensAt);
          setCutoffAt(window.cutoffAt);
          setPrepared(Boolean(value && window.opensAt && window.cutoffAt));
        }} required options={drawDates.map((date) => ({
          value: date,
          label: officialDrawName(date) ?? date,
          description: createdDrawDateSet.has(date) ? "เคยสร้างแล้ว แต่สามารถสร้างซ้ำได้" : "งวดวันที่ 1 หรือ 16",
          badge: createdDrawDateSet.has(date) ? "มีงวดเดิม" : undefined,
        }))} /></label>
        <label htmlFor="opensAt">วันเวลาเปิดรับ<DateTimePicker id="opensAt" value={opensAt} onChange={setOpensAt} required /></label>
        <label htmlFor="cutoffAt">วันเวลาปิดรับ<DateTimePicker id="cutoffAt" value={cutoffAt} onChange={setCutoffAt} required /></label>
      </section>}

      {prepared && isDuplicate && <p className="draw-duplicate-warning" role="status"><strong>กำลังสร้างงวดซ้ำ</strong><span>งวด {drawName} เคยถูกสร้างแล้ว ระบบจะเก็บรายการใหม่นี้เป็นคนละงวด</span></p>}

      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message !== null && <p role="status">{state.message}</p>}

      {prepared && <div className="draw-create-submit"><small>ตรวจสอบข้อมูลด้านบนก่อนยืนยัน ระบบจะยังไม่สร้างจนกดปุ่มนี้</small><button type="submit" disabled={pending || !drawDate || !opensAt || !cutoffAt}>{pending ? "กำลังบันทึก..." : isDuplicate ? "ยืนยันสร้างงวดซ้ำ" : "ยืนยันสร้างงวด"}</button></div>}
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

export function DeleteDrawForm({ drawId, drawName, billCount }: { drawId: string; drawName: string; billCount: number }) {
  const [state, formAction, pending] = useActionState(deleteDrawAction, INITIAL);

  return (
    <form className="delete-draw-form" action={formAction} onSubmit={(event) => {
      const detail = billCount > 0 ? ` รวมบิล ${billCount} ใบและหลักฐานทั้งหมด` : "";
      if (!window.confirm(`ลบงวด “${drawName}” ถาวร${detail}ใช่ไหม? การดำเนินการนี้ย้อนกลับจากหน้าเว็บไม่ได้`)) event.preventDefault();
    }}>
      <input type="hidden" name="drawId" value={drawId} />
      {state.error !== null && <p className="error" role="alert">{state.error}</p>}
      {state.message !== null && <p role="status">{state.message}</p>}
      <button type="submit" className="danger-button" disabled={pending}>
        {pending ? "กำลังลบ..." : "ลบงวด"}
      </button>
    </form>
  );
}

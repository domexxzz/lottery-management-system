"use client";

import { useActionState, useState } from "react";
import { defaultOfficialDrawWindow, officialDrawName, parseBangkokDateTimeLocal, toBangkokDateTimeLocal } from "@/lib/draws/schedule";
import { AppDropdown } from "../AppDropdown";
import { createDrawAction, createLaoDrawAction, deleteDrawAction, lockDrawAction, reopenDrawAction, type ActionState } from "./actions";
import { DatePicker, DateTimePicker } from "@/components/calendar";
import { LAO_DEFAULT_TIMES, isLaoDrawDay } from "@/lib/lao/rules";

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

export function CreateDrawForm({ drawDates, automaticDrawDate, createdDrawDates, autoPrepare = false }: { drawDates: string[]; automaticDrawDate: string; createdDrawDates: string[]; autoPrepare?: boolean }) {
  const [state, formAction, pending] = useActionState(createDrawAction, INITIAL);
  // เข้ามาจากขั้นเลือกประเภทหวยแล้ว: เตรียมงวดถัดไปพร้อมเวลาให้ทันที ไม่ต้องกดอีกปุ่ม
  const initialWindow = autoPrepare ? defaultWindow(automaticDrawDate) : { opensAt: "", cutoffAt: "" };
  const [drawDate, setDrawDate] = useState(autoPrepare ? automaticDrawDate : "");
  const [opensAt, setOpensAt] = useState(initialWindow.opensAt);
  const [cutoffAt, setCutoffAt] = useState(initialWindow.cutoffAt);
  const [prepared, setPrepared] = useState(Boolean(autoPrepare && automaticDrawDate && initialWindow.opensAt && initialWindow.cutoffAt));
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

      {!autoPrepare && <div className="draw-create-toolbar" aria-label="วิธีตั้งค่างวด">
        <button type="button" className={prepared ? "active" : ""} onClick={applyAutomaticSchedule}>สร้างอัตโนมัติ</button>
      </div>}

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

export function LockDrawForm({ drawId, paired = false }: { drawId: string; paired?: boolean }) {
  const [state, formAction, pending] = useActionState(lockDrawAction, INITIAL);

  return (
    <form action={formAction} onSubmit={(event) => {
      const confirmation = paired
        ? "ปิดรับหวยลาวและหวยลาวชุดคู่นี้พร้อมกัน และยกเลิกบิลร่างที่ค้างอยู่ใช่ไหม?"
        : "ปิดรับงวดนี้และยกเลิกบิลร่างที่ค้างอยู่ใช่ไหม?";
      if (!window.confirm(confirmation)) event.preventDefault();
    }}>
      <input type="hidden" name="drawId" value={drawId} />
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.message !== null && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending}>
        {pending ? "กำลังปิดงวด..." : paired ? "ปิดคู่งวดตอนนี้" : "ปิดงวดตอนนี้"}
      </button>
    </form>
  );
}

export function ReopenDrawForm({
  drawId,
  drawName,
  paired = false,
  suggestedCutoffAt,
}: {
  drawId: string;
  drawName: string;
  paired?: boolean;
  suggestedCutoffAt: string;
}) {
  const [state, formAction, pending] = useActionState(reopenDrawAction, INITIAL);
  const [cutoffAt, setCutoffAt] = useState(suggestedCutoffAt);

  return <details className="reopen-draw-form">
    <summary>{paired ? "เปิดรับคู่งวดอีกครั้ง" : "เปิดรับอีกครั้ง"}</summary>
    <form action={formAction} onSubmit={(event) => {
      const target = paired ? "หวยลาวและหวยลาวชุดคู่นี้" : `งวด “${drawName}”`;
      if (!window.confirm(`เปิดรับ${target}อีกครั้งจนถึงเวลาที่กำหนดใช่ไหม?`)) event.preventDefault();
    }}>
      <input type="hidden" name="drawId" value={drawId} />
      <input type="hidden" name="cutoffAt" value={cutoffAt} />
      <label htmlFor={`reopen-cutoff-${drawId}`}>เวลาปิดรับใหม่<DateTimePicker id={`reopen-cutoff-${drawId}`} value={cutoffAt} onChange={setCutoffAt} required /></label>
      <small>บิลที่ล็อกไว้จะกลับมาใช้งาน และ Agent จะสร้าง/แก้บิลได้จนถึงเวลานี้</small>
      {state.error !== null && <p className="error" role="alert">{state.error}</p>}
      {state.message !== null && <p role="status">{state.message}</p>}
      <button type="submit" disabled={pending || !cutoffAt}>{pending ? "กำลังเปิดรับ..." : "ยืนยันเปิดรับอีกครั้ง"}</button>
    </form>
  </details>;
}

export function DeleteDrawForm({ drawId, drawName, billCount }: { drawId: string; drawName: string; billCount: number }) {
  const [state, formAction, pending] = useActionState(deleteDrawAction, INITIAL);
  const confirmation = billCount > 0
    ? `ลบงวด “${drawName}” พร้อมบิล ${billCount} ใบ รายการเลข และหลักฐานทั้งหมดถาวรใช่ไหม? การดำเนินการนี้ย้อนกลับไม่ได้`
    : `ลบงวด “${drawName}” ถาวรใช่ไหม? การดำเนินการนี้ย้อนกลับจากหน้าเว็บไม่ได้`;

  return (
    <form className="delete-draw-form" action={formAction} onSubmit={(event) => {
      if (!window.confirm(confirmation)) event.preventDefault();
    }}>
      <input type="hidden" name="drawId" value={drawId} />
      {state.error !== null && <p className="error" role="alert">{state.error}</p>}
      {state.message !== null && <p role="status">{state.message}</p>}
      {billCount > 0 && <p className="notice">งวดนี้มีบิล {billCount} ใบ การลบจะลบบิล รายการเลข และหลักฐานของงวดนี้ทั้งหมด</p>}
      <button type="submit" className="danger-button" disabled={pending}>
        {pending ? "กำลังลบ..." : billCount > 0 ? `ลบงวดพร้อม ${billCount} บิล` : "ลบงวด"}
      </button>
    </form>
  );
}

/** วันจันทร์–ศุกร์ที่ใกล้ที่สุดตั้งแต่วันนี้ (เวลาไทย) */
function nextLaoDrawDate(now: Date): string {
  const date = new Date(now.getTime() + 7 * 3_600_000);
  for (let index = 0; index < 7; index += 1) {
    const value = date.toISOString().slice(0, 10);
    if (isLaoDrawDay(value)) return value;
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

type LaoType = "LAO" | "LAO_SET";
const LAO_LABEL: Record<LaoType, string> = { LAO: "หวยลาว", LAO_SET: "หวยลาวชุด" };

/**
 * สร้างงวดหวยลาว หรือหวยลาวชุด
 *
 * ระบบใส่ค่ามาตรฐานให้ (วันจันทร์–ศุกร์ถัดไป เปิด 10:00 รับถึง 20:30 ออกผล 20:30) แก้ได้ทุกช่อง
 * เลือกสร้างอีกประเภทของวันเดียวกันพร้อมกันได้ เพราะใช้ผลชุดเดียวกัน
 */
export function CreateLaoDrawForm({ lotteryType, createdDates }: { lotteryType: LaoType; createdDates: { date: string; lotteryType: string }[] }) {
  const [state, formAction, pending] = useActionState(createLaoDrawAction, INITIAL);
  const companion: LaoType = lotteryType === "LAO" ? "LAO_SET" : "LAO";
  const [drawDate, setDrawDate] = useState(() => nextLaoDrawDate(new Date()));
  const [opensAt, setOpensAt] = useState(`${drawDate}T${LAO_DEFAULT_TIMES.opens}`);
  const [cutoffAt, setCutoffAt] = useState(`${drawDate}T${LAO_DEFAULT_TIMES.cutoff}`);
  const [resultAt, setResultAt] = useState(`${drawDate}T${LAO_DEFAULT_TIMES.result}`);
  const [withCompanion, setWithCompanion] = useState(false);
  const existing = new Set(createdDates.filter((row) => row.date === drawDate).map((row) => row.lotteryType));
  const mainExists = existing.has(lotteryType);
  const companionExists = existing.has(companion);
  const weekend = drawDate !== "" && !isLaoDrawDay(drawDate);

  function changeDate(value: string) {
    setDrawDate(value);
    setOpensAt(`${value}T${LAO_DEFAULT_TIMES.opens}`);
    setCutoffAt(`${value}T${LAO_DEFAULT_TIMES.cutoff}`);
    setResultAt(`${value}T${LAO_DEFAULT_TIMES.result}`);
  }

  return (
    <form action={formAction} className="lao-draw-form" onSubmit={(event) => {
      const duplicateNames = [mainExists ? LAO_LABEL[lotteryType] : null, withCompanion && companionExists ? LAO_LABEL[companion] : null].filter(Boolean);
      if (duplicateNames.length > 0 && !window.confirm(`งวด${duplicateNames.join(" และ ")}ของวันนี้มีอยู่แล้ว ต้องการสร้างซ้ำหรือไม่?`)) event.preventDefault();
    }}>
      <input type="hidden" name="drawDate" value={drawDate} />
      <input type="hidden" name="opensAt" value={opensAt} />
      <input type="hidden" name="cutoffAt" value={cutoffAt} />
      <input type="hidden" name="resultAt" value={resultAt} />
      <input type="hidden" name="lotteryType" value={lotteryType} />
      {withCompanion && <input type="hidden" name="lotteryType" value={companion} />}

      <section className="draw-manual-settings lao-draw-settings" aria-label={`ตั้งค่างวด${LAO_LABEL[lotteryType]}`}>
        <label htmlFor="laoDrawDate">วันออกผล
          <DatePicker id="laoDrawDate" value={drawDate} onChange={changeDate} required />
        </label>
        <label htmlFor="laoResultAt">เวลาออกผล<DateTimePicker id="laoResultAt" value={resultAt} onChange={setResultAt} required /></label>
        <label htmlFor="laoOpensAt">วันเวลาเปิดรับ<DateTimePicker id="laoOpensAt" value={opensAt} onChange={setOpensAt} required /></label>
        <label htmlFor="laoCutoffAt">วันเวลาปิดรับ<DateTimePicker id="laoCutoffAt" value={cutoffAt} onChange={setCutoffAt} required /></label>
      </section>
      <p className="draw-form-note">ค่าเริ่มต้น: ออกผลจันทร์–ศุกร์ 20:30 น. เปิดรับ 10:00 รับถึง 20:30 แก้ได้ทุกช่อง</p>
      {weekend && <p className="draw-duplicate-warning" role="status"><strong>วันที่เลือกเป็นวันเสาร์หรืออาทิตย์</strong><span>ปกติหวยลาวไม่ออกวันนี้ ตรวจให้แน่ใจก่อนสร้าง</span></p>}
      {(mainExists || (withCompanion && companionExists)) && <p className="draw-duplicate-warning" role="status"><strong>กำลังสร้างงวดซ้ำ</strong><span>งวด{[mainExists ? LAO_LABEL[lotteryType] : null, withCompanion && companionExists ? LAO_LABEL[companion] : null].filter(Boolean).join(" และ ")}ของวันนี้มีอยู่แล้ว ระบบจะเก็บงวดใหม่เป็นคนละงวด</span></p>}

      <label className="lao-companion">
        <input type="checkbox" checked={withCompanion} onChange={(event) => setWithCompanion(event.target.checked)} />
        <span>สร้าง{LAO_LABEL[companion]}ของวันเดียวกันด้วย</span>
        <small>{companionExists ? `มีงวด${LAO_LABEL[companion]}ของวันนี้แล้ว ติ๊กแล้วจะสร้างซ้ำ` : "ใช้ผลชุดเดียวกัน ลงผลครั้งเดียวได้ทั้งสองงวด"}</small>
      </label>

      {state.error !== null && <p className="error" role="alert">{state.error}</p>}
      {state.message !== null && <p role="status">{state.message}</p>}
      <div className="draw-create-submit">
        <small>ตรวจวันและเวลาก่อนยืนยัน ระบบจะยังไม่สร้างจนกดปุ่มนี้</small>
        <button type="submit" disabled={pending || !drawDate}>
          {pending ? "กำลังสร้าง..." : `${mainExists ? "ยืนยันสร้างงวดซ้ำ" : "ยืนยันสร้างงวด"}${LAO_LABEL[lotteryType]}${withCompanion ? ` + ${LAO_LABEL[companion]}` : ""}`}
        </button>
      </div>
    </form>
  );
}

type WizardType = "THAI_GOVERNMENT" | LaoType;

/**
 * สร้างงวดแบบทีละขั้น: กดสร้างงวด → เลือกประเภทหวย → ตั้งวันและเวลา
 */
export function CreateDrawWizard({ thai, laoCreated }: {
  thai: { drawDates: string[]; automaticDrawDate: string; createdDrawDates: string[] };
  laoCreated: { date: string; lotteryType: string }[];
}) {
  const [step, setStep] = useState<"idle" | "type" | WizardType>("idle");

  if (step === "idle") {
    return (
      <div className="draw-wizard-start">
        <button type="button" onClick={() => setStep("type")}>＋ สร้างงวดใหม่</button>
        <small>เลือกประเภทหวยก่อน แล้วค่อยตั้งวันและเวลา</small>
      </div>
    );
  }

  if (step === "type") {
    const options: { value: WizardType; title: string; detail: string }[] = [
      { value: "THAI_GOVERNMENT", title: "หวยรัฐบาล", detail: "งวดวันที่ 1 และ 16 ระบบเลือกงวดถัดไปและเวลาให้" },
      { value: "LAO", title: "หวยลาว", detail: "ออกผลจันทร์–ศุกร์ 20:30 น. แทงได้ทุกเลข" },
      { value: "LAO_SET", title: "หวยลาวชุด", detail: "เลขชุด 4 หลัก ลุ้น 8 รางวัล จ่ายรางวัลสูงสุดหนึ่งรางวัล" },
    ];
    return (
      <div className="draw-wizard">
        <p className="draw-wizard-step"><b>ขั้นที่ 1</b> เลือกประเภทหวยที่จะสร้างงวด</p>
        <div className="draw-wizard-types">
          {options.map((option) => (
            <button key={option.value} type="button" onClick={() => setStep(option.value)}>
              <strong>{option.title}</strong>
              <span>{option.detail}</span>
            </button>
          ))}
        </div>
        <button type="button" className="secondary-button" onClick={() => setStep("idle")}>ยกเลิก</button>
      </div>
    );
  }

  const title = step === "THAI_GOVERNMENT" ? "หวยรัฐบาล" : LAO_LABEL[step];
  return (
    <div className="draw-wizard">
      <div className="draw-wizard-chosen">
        <p className="draw-wizard-step"><b>ขั้นที่ 2</b> ตั้งวันและเวลาของงวด<strong>{title}</strong></p>
        <button type="button" className="secondary-button" onClick={() => setStep("type")}>← เปลี่ยนประเภทหวย</button>
      </div>
      {step === "THAI_GOVERNMENT"
        ? <CreateDrawForm {...thai} autoPrepare />
        : <CreateLaoDrawForm key={step} lotteryType={step} createdDates={laoCreated} />}
    </div>
  );
}

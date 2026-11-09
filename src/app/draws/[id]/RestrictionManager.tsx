"use client";

import { useActionState, useState } from "react";
import { addRestrictionAction, removeRestrictionAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, message: null };

export type RestrictionRow = {
  id: string;
  number: string;
  kind: "CLOSED" | "REDUCED_RATE";
  payoutRate: string | null;
  prizeTypeName: string;
  normalRate: string;
};

export type RestrictionPrizeOption = { id: string; name: string; digits: number; payoutRate: string };

function RemoveButton({ id }: { id: string }) {
  const [state, action, pending] = useActionState(removeRestrictionAction, INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="restrictionId" value={id} />
      <button type="submit" className="danger-button" disabled={pending}>{pending ? "…" : "ยกเลิก"}</button>
      {state.error && <small className="error">{state.error}</small>}
    </form>
  );
}

/** ตั้งเลขเต็ม (ปิดรับ) และเลขอั้น (จ่ายลด) ของงวดที่ยังเปิดรับ */
export function RestrictionManager({
  drawId,
  editable,
  prizeTypes,
  rows,
}: {
  drawId: string;
  editable: boolean;
  prizeTypes: RestrictionPrizeOption[];
  rows: RestrictionRow[];
}) {
  const [state, action, pending] = useActionState(addRestrictionAction, INITIAL);
  const [kind, setKind] = useState<"CLOSED" | "REDUCED_RATE">("CLOSED");
  const [prizeTypeId, setPrizeTypeId] = useState(prizeTypes[0]?.id ?? "");
  const selected = prizeTypes.find((prizeType) => prizeType.id === prizeTypeId);

  return (
    <section className="restriction-manager" aria-labelledby="restriction-heading">
      <h2 id="restriction-heading">เลขเต็ม / เลขอั้น</h2>
      <p className="muted">เลขเต็มจะปิดรับทันที ส่วนเลขอั้นยังรับได้แต่จ่ายตามอัตราที่ลดลง มีผลเฉพาะโพยที่ยืนยันหลังจากนี้</p>

      {editable ? (
        <form action={action} className="restriction-form">
          <input type="hidden" name="drawId" value={drawId} />
          <label>
            ประเภท
            <select name="kind" value={kind} onChange={(event) => setKind(event.target.value === "REDUCED_RATE" ? "REDUCED_RATE" : "CLOSED")}>
              <option value="CLOSED">เลขเต็ม (ปิดรับ)</option>
              <option value="REDUCED_RATE">เลขอั้น (จ่ายลด)</option>
            </select>
          </label>
          <label>
            รางวัล
            <select name="prizeTypeId" value={prizeTypeId} onChange={(event) => setPrizeTypeId(event.target.value)}>
              {prizeTypes.map((prizeType) => <option key={prizeType.id} value={prizeType.id}>{prizeType.name}</option>)}
            </select>
          </label>
          <label>
            เลข
            <input name="number" inputMode="numeric" pattern="\d*" maxLength={selected?.digits ?? 6} placeholder={"0".repeat(selected?.digits ?? 3)} required />
          </label>
          {kind === "REDUCED_RATE" && (
            <label>
              จ่าย (ปกติ {selected?.payoutRate ?? "-"})
              <input name="payoutRate" inputMode="decimal" required placeholder="เช่น 450" />
            </label>
          )}
          <button type="submit" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          {state.error && <p className="error" role="alert">{state.error}</p>}
          {state.message && <p className="success" role="status">{state.message}</p>}
        </form>
      ) : (
        <p className="muted">งวดนี้ปิดรับแล้ว แก้ไขเลขเต็ม/เลขอั้นไม่ได้</p>
      )}

      {rows.length === 0 ? (
        <p className="muted">ยังไม่มีเลขเต็มหรือเลขอั้น</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">ประเภท</th>
                <th scope="col">รางวัล</th>
                <th scope="col">เลข</th>
                <th scope="col" className="num">อัตราจ่าย</th>
                {editable && <th scope="col"><span className="sr-only">จัดการ</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td><span className={`status-pill ${row.kind === "CLOSED" ? "danger" : "warning"}`}>{row.kind === "CLOSED" ? "เลขเต็ม" : "เลขอั้น"}</span></td>
                  <td>{row.prizeTypeName}</td>
                  <td><strong>{row.number}</strong></td>
                  <td className="num">{row.kind === "CLOSED" ? "ปิดรับ" : `${row.payoutRate} (ปกติ ${row.normalRate})`}</td>
                  {editable && <td><RemoveButton id={row.id} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

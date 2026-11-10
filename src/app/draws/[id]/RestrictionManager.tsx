"use client";

import { useActionState, useState } from "react";
import "./restriction-manager.css";
import { addRestrictionAction, removeRestrictionAction, updateNumberCapAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, message: null };

export type RestrictionRow = {
  id: string;
  number: string;
  kind: "CLOSED" | "REDUCED_RATE";
  payoutRate: string | null;
  prizeTypeName: string;
  normalRate: string;
};

export type FullNumberRow = { key: string; prizeTypeName: string; number: string; used: string };

export type RestrictionPrizeOption = { id: string; code: number; name: string; digits: number; payoutRate: string };

type RestrictionScope =
  | "THREE_TOP"
  | "THREE_TOD"
  | "THREE_BOTH"
  | "TWO_TOP"
  | "TWO_BOTTOM"
  | "TWO_BOTH"
  | `TYPE:${string}`;

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

function NumberCapForm({ drawId, numberCap, editable }: { drawId: string; numberCap: string; editable: boolean }) {
  const [state, action, pending] = useActionState(updateNumberCapAction, INITIAL);
  return (
    <form action={action} className="number-cap-form">
      <input type="hidden" name="drawId" value={drawId} />
      <label>
        เพดานรับต่อเลข (บาท)
        <input name="numberCap" inputMode="decimal" defaultValue={numberCap} placeholder="ไม่จำกัด" disabled={!editable} aria-describedby="number-cap-help" />
      </label>
      {editable && <button type="submit" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึกเพดาน"}</button>}
      <small id="number-cap-help">
        ยอดแทงของเลขเดียวกันในประเภทเดียวกัน รวมทุก Agent ทั้งงวด ครบเพดานแล้วเป็นเลขเต็ม ระบบปิดรับเอง · ค่าเริ่มต้น 2,000 · เว้นว่าง = ไม่จำกัด
      </small>
      {state.error && <p className="error" role="alert">{state.error}</p>}
      {state.message && <p className="success" role="status">{state.message}</p>}
    </form>
  );
}

/** ตั้งเลขอั้น (จ่ายลด) และเพดานต่อเลขของงวดที่ยังเปิดรับ */
export function RestrictionManager({
  drawId,
  editable,
  prizeTypes,
  rows,
  numberCap,
  capLabel,
  fullNumbers,
}: {
  drawId: string;
  editable: boolean;
  prizeTypes: RestrictionPrizeOption[];
  rows: RestrictionRow[];
  numberCap: string;
  capLabel: string;
  fullNumbers: FullNumberRow[];
}) {
  const reducedRows = rows.filter((row) => row.kind === "REDUCED_RATE");
  const closedRows = rows.filter((row) => row.kind === "CLOSED");
  const [state, action, pending] = useActionState(addRestrictionAction, INITIAL);
  const threeTop = prizeTypes.find((prizeType) => prizeType.code === 1);
  const threeTod = prizeTypes.find((prizeType) => prizeType.code === 2);
  const twoTop = prizeTypes.find((prizeType) => prizeType.code === 5);
  const twoBottom = prizeTypes.find((prizeType) => prizeType.code === 6);
  const scopedCodes = new Set([1, 2, 5, 6]);
  const otherPrizeTypes = prizeTypes.filter((prizeType) => !scopedCodes.has(prizeType.code));
  const [scope, setScope] = useState<RestrictionScope>(
    threeTop ? "THREE_TOP" : twoTop ? "TWO_TOP" : `TYPE:${prizeTypes[0]?.id ?? ""}`,
  );
  const selected = scope.startsWith("TYPE:")
    ? prizeTypes.find((prizeType) => prizeType.id === scope.slice(5))
    : scope === "THREE_TOD"
      ? threeTod
      : scope === "TWO_TOP"
        ? twoTop
        : scope === "TWO_BOTTOM"
          ? twoBottom
          : scope === "TWO_BOTH"
            ? twoTop
            : threeTop;
  const scopeOptions: { value: RestrictionScope; label: string }[] = [
    ...(threeTop && threeTod ? [
      { value: "THREE_TOP" as const, label: "เฉพาะ 3 ตัวบน" },
      { value: "THREE_TOD" as const, label: "เฉพาะ 3 ตัวโต๊ด" },
      { value: "THREE_BOTH" as const, label: "ทั้ง 3 ตัวบนและโต๊ด" },
    ] : []),
    ...(twoTop && twoBottom ? [
      { value: "TWO_TOP" as const, label: "เฉพาะ 2 ตัวบน" },
      { value: "TWO_BOTTOM" as const, label: "เฉพาะ 2 ตัวล่าง" },
      { value: "TWO_BOTH" as const, label: "ทั้ง 2 ตัวบนและล่าง" },
    ] : []),
    ...otherPrizeTypes.map((prizeType) => ({ value: `TYPE:${prizeType.id}` as const, label: prizeType.name })),
  ];

  return (
    <section className="restriction-manager" aria-label="กำหนดเลขอั้นและเลขเต็ม">
      <NumberCapForm drawId={drawId} numberCap={numberCap} editable={editable} />
      {editable ? (
        <form action={action} className="restriction-form">
          <input type="hidden" name="drawId" value={drawId} />
          <input type="hidden" name="restrictionScope" value={scope} />
          <input type="hidden" name="kind" value="REDUCED_RATE" />
          <label>
            ขอบเขต
            <select value={scope} onChange={(event) => setScope(event.target.value as RestrictionScope)}>
              {scopeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            เลข
            <input name="number" inputMode="numeric" pattern="\d*" maxLength={selected?.digits ?? 6} placeholder={"0".repeat(selected?.digits ?? 3)} required />
          </label>
          <button type="submit" disabled={pending}>{pending ? "กำลังบันทึก…" : "บันทึก"}</button>
          {state.error && <p className="error" role="alert">{state.error}</p>}
          {state.message && <p className="success" role="status">{state.message}</p>}
        </form>
      ) : (
        <p className="muted">งวดนี้ปิดรับแล้ว แก้ไขเลขอั้นไม่ได้</p>
      )}

      {(threeTop && threeTod) || (twoTop && twoBottom) ? (
        <details className="restriction-examples">
          <summary>ดูตัวอย่างขอบเขตเลขอั้น</summary>
          {threeTop && threeTod && <><strong>ตัวอย่างเลข 123</strong>
          <ul>
            <li><b>เฉพาะ 3 ตัวบน</b><span>อั้นเฉพาะเลขตรง 123 · โต๊ดไม่ถูกอั้น</span></li>
            <li><b>เฉพาะ 3 ตัวโต๊ด</b><span>อั้นทั้ง 123, 132, 213, 231, 312, 321 · ตัวบนไม่ถูกอั้น</span></li>
            <li><b>ทั้งบนและโต๊ด</b><span>อั้นเลขตรง 123 และเลขโต๊ดครบทุกลำดับพร้อมกัน</span></li>
          </ul></>}
          {twoTop && twoBottom && <><strong>ตัวอย่างเลข 25</strong>
          <ul>
            <li><b>เฉพาะ 2 ตัวบน</b><span>อั้นเฉพาะ 2 ตัวบนเลข 25 · ตัวล่างไม่ถูกอั้น</span></li>
            <li><b>เฉพาะ 2 ตัวล่าง</b><span>อั้นเฉพาะ 2 ตัวล่างเลข 25 · ตัวบนไม่ถูกอั้น</span></li>
            <li><b>ทั้งบนและล่าง</b><span>อั้นเลข 25 ทั้ง 2 ตัวบนและ 2 ตัวล่างพร้อมกัน</span></li>
          </ul></>}
        </details>
      ) : null}

      <div className="restriction-boards">
        <section className="restriction-board is-reduced" aria-labelledby="restriction-reduced-heading">
          <header>
            <h3 id="restriction-reduced-heading">เลขอั้น</h3>
            <span>{reducedRows.length} เลข · รับแต่จ่ายลด</span>
          </header>
          {reducedRows.length === 0 ? (
            <p className="restriction-board-empty">ยังไม่มีเลขอั้น</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">เลข</th>
                  <th scope="col" className="num">อัตราจ่าย</th>
                  {editable && <th scope="col"><span className="sr-only">จัดการ</span></th>}
                </tr>
              </thead>
              <tbody>
                {reducedRows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.number}</strong><small>{row.prizeTypeName}</small></td>
                    <td className="num"><strong>{row.payoutRate ?? "-"}</strong><small>ปกติ {row.normalRate}</small></td>
                    {editable && <td><RemoveButton id={row.id} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="restriction-board is-full" aria-labelledby="restriction-full-heading">
          <header>
            <h3 id="restriction-full-heading">เลขเต็ม</h3>
            <span>{fullNumbers.length + closedRows.length} เลข · ปิดรับ · เพดานเลขละ {capLabel}{capLabel === "ไม่จำกัด" ? "" : " บาท"}</span>
          </header>
          {fullNumbers.length + closedRows.length === 0 ? (
            <p className="restriction-board-empty">ยังไม่มีเลขเต็ม</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">เลข</th>
                  <th scope="col" className="num">สถานะ</th>
                  {editable && closedRows.length > 0 && <th scope="col"><span className="sr-only">จัดการ</span></th>}
                </tr>
              </thead>
              <tbody>
                {fullNumbers.map((row) => (
                  <tr key={row.key}>
                    <td><strong>{row.number}</strong><small>{row.prizeTypeName}</small></td>
                    <td className="num"><strong>ปิดรับ</strong><small>ยอดรวม {row.used} บาท</small></td>
                    {editable && closedRows.length > 0 && <td />}
                  </tr>
                ))}
                {closedRows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{row.number}</strong><small>{row.prizeTypeName}</small></td>
                    <td className="num"><strong>ปิดรับ</strong><small>ตั้งปิดไว้เอง</small></td>
                    {editable && <td><RemoveButton id={row.id} /></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </section>
  );
}

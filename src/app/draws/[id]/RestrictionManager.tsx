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

/** ตั้งเลขอั้น (จ่ายลด) ของงวดที่ยังเปิดรับ */
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
    <section className="restriction-manager" aria-label="กำหนดเลขอั้น">
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

      {rows.length === 0 ? (
        <p className="muted">ยังไม่มีเลขอั้น</p>
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
                  <td><span className={`status-pill ${row.kind === "CLOSED" ? "danger" : "warning"}`}>{row.kind === "CLOSED" ? "ปิดรับ (รายการเดิม)" : "เลขอั้น"}</span></td>
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

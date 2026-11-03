"use client";

import { useActionState, useState } from "react";
import { createBillAction, type ActionState } from "../actions";

const INITIAL: ActionState = { error: null };
const STARTING_ROWS = 3;

export type DrawOption = { id: string; name: string; cutoffAt: string };
export type PrizeOption = { id: string; code: number; name: string; digits: number };

export function BillForm({
  draws,
  prizeTypes,
}: {
  draws: DrawOption[];
  prizeTypes: PrizeOption[];
}) {
  const [state, formAction, pending] = useActionState(createBillAction, INITIAL);
  const [rowCount, setRowCount] = useState(STARTING_ROWS);

  const firstPrize = prizeTypes[0];

  return (
    <form action={formAction}>
      <label htmlFor="title">
        ชื่อบิลหรือรหัสอ้างอิงลูกค้า
        <input id="title" name="title" required maxLength={120} />
      </label>

      <label htmlFor="drawId">
        รอบ
        <select id="drawId" name="drawId" required>
          {draws.map((draw) => (
            <option key={draw.id} value={draw.id}>
              {draw.name} — ปิดรับ {draw.cutoffAt}
            </option>
          ))}
        </select>
      </label>

      <h2>รายการ</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">ประเภทรางวัล</th>
            <th scope="col">เลข</th>
            <th scope="col">ยอดเดิมพัน</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, i) => (
            <tr key={i}>
              <td>
                <select name="prizeTypeId" defaultValue={firstPrize?.id} aria-label={`ประเภทรางวัล แถวที่ ${i + 1}`}>
                  {prizeTypes.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code}. {p.name} ({p.digits} หลัก)
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input
                  name="number"
                  inputMode="numeric"
                  maxLength={12}
                  aria-label={`เลข แถวที่ ${i + 1}`}
                />
              </td>
              <td>
                <input
                  name="stake"
                  inputMode="decimal"
                  maxLength={20}
                  aria-label={`ยอดเดิมพัน แถวที่ ${i + 1}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        <button type="button" onClick={() => setRowCount((n) => n + 1)}>
          เพิ่มแถว
        </button>
      </p>

      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending}>
        {pending ? "กำลังบันทึก..." : "บันทึกเป็นร่าง"}
      </button>
    </form>
  );
}

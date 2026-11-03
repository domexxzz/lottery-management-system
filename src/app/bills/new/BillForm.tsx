"use client";

import { useActionState, useState } from "react";
import { checkNumberField, checkRowComplete, checkStakeField } from "@/lib/bills/fieldChecks";
import { createBillAction, type ActionState } from "../actions";

const INITIAL: ActionState = { error: null };
const STARTING_ROWS = 3;

export type DrawOption = { id: string; name: string; cutoffAt: string };
export type PrizeOption = { id: string; code: number; name: string; digits: number };

type Row = { prizeTypeId: string; number: string; stake: string };

export function BillForm({
  draws,
  prizeTypes,
}: {
  draws: DrawOption[];
  prizeTypes: PrizeOption[];
}) {
  const [state, formAction, pending] = useActionState(createBillAction, INITIAL);

  const firstPrizeId = prizeTypes[0]?.id ?? "";
  const [rows, setRows] = useState<Row[]>(() =>
    Array.from({ length: STARTING_ROWS }, () => ({
      prizeTypeId: firstPrizeId,
      number: "",
      stake: "",
    })),
  );

  const digitsOf = (prizeTypeId: string) =>
    prizeTypes.find((p) => p.id === prizeTypeId)?.digits ?? 0;

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const rowIssues = rows.map((row) => ({
    number: checkNumberField(row.number, digitsOf(row.prizeTypeId)),
    stake: checkStakeField(row.stake),
    row: checkRowComplete(row.number, row.stake),
  }));

  const hasFieldIssue = rowIssues.some((i) => i.number ?? i.stake ?? i.row);
  const filledRows = rows.filter((r) => r.number.trim() !== "" || r.stake.trim() !== "").length;

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
          {rows.map((row, i) => {
            const issue = rowIssues[i];
            return (
              <tr key={i}>
                <td>
                  <select
                    name="prizeTypeId"
                    value={row.prizeTypeId}
                    onChange={(e) => updateRow(i, { prizeTypeId: e.target.value })}
                    aria-label={`ประเภทรางวัล แถวที่ ${i + 1}`}
                  >
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
                    value={row.number}
                    onChange={(e) => updateRow(i, { number: e.target.value })}
                    aria-label={`เลข แถวที่ ${i + 1}`}
                    aria-invalid={issue?.number != null}
                  />
                  {issue?.number != null && <small className="error">{issue.number}</small>}
                </td>
                <td>
                  <input
                    name="stake"
                    inputMode="decimal"
                    maxLength={20}
                    value={row.stake}
                    onChange={(e) => updateRow(i, { stake: e.target.value })}
                    aria-label={`ยอดเดิมพัน แถวที่ ${i + 1}`}
                    aria-invalid={issue?.stake != null}
                  />
                  {issue?.stake != null && <small className="error">{issue.stake}</small>}
                  {issue?.stake == null && issue?.row != null && (
                    <small className="error">{issue.row}</small>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p>
        <button
          type="button"
          onClick={() =>
            setRows((current) => [
              ...current,
              { prizeTypeId: firstPrizeId, number: "", stake: "" },
            ])
          }
        >
          เพิ่มแถว
        </button>
      </p>

      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <p className="muted">
        กรอกแล้ว {filledRows} รายการ · กฎเลขซ้ำ วงเงิน และเวลาปิดรับตรวจอีกครั้งตอนบันทึก
      </p>

      <button type="submit" disabled={pending || hasFieldIssue || filledRows === 0}>
        {pending ? "กำลังบันทึก..." : "บันทึกเป็นร่าง"}
      </button>
    </form>
  );
}

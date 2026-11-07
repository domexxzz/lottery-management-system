"use client";

import { useActionState } from "react";
import { AppDropdown } from "../AppDropdown";
import { updatePrizeTypeAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, message: null };

export type PrizeTypeRowData = {
  id: string;
  code: number;
  name: string;
  digits: number;
  /** ว่าง = เท่ากับ digits */
  resultDigits: string;
  matchRule: string;
  payoutRate: string;
  maxStakePerItem: string;
  isActive: boolean;
  usedInItems: number;
};

export function PrizeTypeRow({ data }: { data: PrizeTypeRowData }) {
  const [state, formAction, pending] = useActionState(updatePrizeTypeAction, INITIAL);

  return (
    <tr>
      <td>
        <strong>{data.code}</strong>
      </td>
      <td colSpan={7}>
        <form action={formAction} className="rulebook-row">
          <input type="hidden" name="prizeTypeId" value={data.id} />

          <input
            name="name"
            defaultValue={data.name}
            required
            maxLength={60}
            aria-label={`ชื่อรางวัลที่ ${data.code}`}
          />
          <input
            name="digits"
            type="number"
            min={1}
            max={6}
            defaultValue={data.digits}
            required
            aria-label={`จำนวนหลักของเลขที่แทงของรางวัลที่ ${data.code}`}
          />
          <input
            name="resultDigits"
            type="number"
            min={1}
            max={6}
            defaultValue={data.resultDigits}
            placeholder="ผล = เท่าเลขแทง"
            aria-label={`จำนวนหลักของผลรางวัลที่ ${data.code}`}
          />
          <input
            name="payoutRate"
            inputMode="decimal"
            defaultValue={data.payoutRate}
            required
            aria-label={`อัตราจ่ายของรางวัลที่ ${data.code}`}
          />
          <input
            name="maxStakePerItem"
            inputMode="decimal"
            defaultValue={data.maxStakePerItem}
            placeholder="ไม่จำกัด"
            aria-label={`วงเงินต่อรายการของรางวัลที่ ${data.code}`}
          />

          <AppDropdown
            name="matchRule"
            defaultValue={data.matchRule}
            ariaLabel={`วิธีตัดสินรางวัลที่ ${data.code}`}
            options={[{ value: "EXACT", label: "ตรงทุกหลัก" }, { value: "PERMUTATION", label: "โต๊ด" }, { value: "CONTAINS_DIGIT", label: "วิ่ง" }]}
          />

          <label className="inline-check">
            <input type="checkbox" name="isActive" defaultChecked={data.isActive} />
            เปิดใช้
          </label>

          <input
            name="reason"
            required
            maxLength={200}
            placeholder="เหตุผลที่แก้"
            aria-label={`เหตุผลที่แก้รางวัลที่ ${data.code}`}
          />

          <button type="submit" disabled={pending}>
            {pending ? "..." : "บันทึก"}
          </button>

          {state.error !== null && (
            <span className="error" role="alert">
              {state.error}
            </span>
          )}
          {state.message !== null && <span role="status">{state.message}</span>}
          {data.usedInItems > 0 && (
            <span className="muted">ใช้ไปแล้ว {data.usedInItems} รายการ</span>
          )}
        </form>
      </td>
    </tr>
  );
}

"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { AppDropdown } from "../../AppDropdown";
import { MIN_STAKE_PER_ITEM } from "@/lib/bills/betting";
import { checkNumberField, checkRowComplete, checkStakeField } from "@/lib/bills/fieldChecks";
import { createBillAction, type ActionState } from "../actions";

const INITIAL: ActionState = { error: null };

export type DrawOption = { id: string; name: string; cutoffAt: string };
export type PrizeOption = { id: string; code: number; name: string; digits: number };
export type RepresentativeOption = {
  id: string;
  displayName: string;
  role: "GODMODE" | "OWNER" | "ADMIN" | "AGENT";
  agent: { id: string; code: string; name: string; status: string } | null;
};

type Row = { id: number; prizeTypeId: string; number: string; stake: string };

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("th-TH").replace(/\s+/g, " ");
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0] ?? 0;
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const above = previous[j] ?? j;
      previous[j] = Math.min(above + 1, (previous[j - 1] ?? i) + 1, diagonal + (left[i - 1] === right[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[right.length] ?? left.length;
}

function customerMatchScore(name: string, query: string): number | null {
  const candidate = normalized(name);
  const search = normalized(query);
  if (!search) return 10;
  if (candidate === search) return 0;
  if (candidate.startsWith(search)) return 1;
  if (candidate.includes(search)) return 2;
  const distance = editDistance(candidate, search);
  return distance <= Math.max(2, Math.floor(Math.max(candidate.length, search.length) * 0.3)) ? 3 + distance : null;
}

export function CustomerNameCombobox({
  names,
  disabledHint,
  label = "ชื่อบิลหรือรหัสอ้างอิงลูกค้า",
  value: controlledValue,
  onValueChange,
  disabled = false,
}: {
  names: string[];
  disabledHint?: string;
  label?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const [innerValue, setInnerValue] = useState("");
  const value = controlledValue ?? innerValue;
  const setValue = onValueChange ?? setInnerValue;
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => names
    .map((name, index) => ({ name, index, score: customerMatchScore(name, value) }))
    .filter((item): item is { name: string; index: number; score: number } => item.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, 8), [names, value]);

  return <label htmlFor="title" className="customer-name-field">
    {label}
    <span className="customer-combobox">
      <input
        id="title"
        name="title"
        required
        maxLength={120}
        disabled={disabled}
        value={value}
        onChange={(event) => { setValue(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        autoComplete="off"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls="customer-name-options"
        placeholder="พิมพ์ชื่อใหม่ หรือค้นหาลูกค้าเดิม"
      />
      {open && matches.length > 0 && <span id="customer-name-options" className="customer-name-options" role="listbox">
        <span className="customer-options-heading" role="presentation"><strong>ลูกค้าเดิมของ Agent</strong><small>{matches.length} รายชื่อที่ใกล้เคียง</small></span>
        {matches.map((item) => <button key={item.name} type="button" role="option" aria-selected={normalized(item.name) === normalized(value)} onMouseDown={(event) => event.preventDefault()} onClick={() => { setValue(item.name); setOpen(false); }}><span className="customer-option-avatar">{item.name.trim().slice(0, 1).toUpperCase()}</span><span className="customer-option-copy"><strong>{item.name}</strong><small>เลือกชื่อนี้เพื่อสร้างบิล</small></span><span className="customer-option-arrow">→</span></button>)}
      </span>}
    </span>
    <small className="customer-field-hint">{disabledHint ?? (names.length > 0 ? `ค้นหาได้จากลูกค้าเดิม ${names.length} คน หรือพิมพ์ชื่อใหม่` : "ยังไม่มีลูกค้าเดิม สามารถพิมพ์ชื่อใหม่ได้")}</small>
  </label>;
}

export function BillForm({
  draws,
  prizeTypes,
  representatives,
  currentRepresentativeId,
  customerNamesByRepresentative,
}: {
  draws: DrawOption[];
  prizeTypes: PrizeOption[];
  representatives: RepresentativeOption[] | null;
  currentRepresentativeId: string | null;
  customerNamesByRepresentative: Record<string, string[]>;
}) {
  const [state, formAction, pending] = useActionState(createBillAction, INITIAL);

  const firstPrizeId = prizeTypes[0]?.id ?? "";
  const nextRowId = useRef(1);
  const [rows, setRows] = useState<Row[]>(() => [
    {
      id: 1,
      prizeTypeId: firstPrizeId,
      number: "",
      stake: "",
    },
  ]);
  const [selectedRepresentativeId, setSelectedRepresentativeId] = useState(currentRepresentativeId ?? "");
  const customerRepresentativeId = representatives === null ? currentRepresentativeId : selectedRepresentativeId;
  const customerNames = customerRepresentativeId ? customerNamesByRepresentative[customerRepresentativeId] ?? [] : [];

  const digitsOf = (prizeTypeId: string) =>
    prizeTypes.find((p) => p.id === prizeTypeId)?.digits ?? 0;

  function updateRow(index: number, patch: Partial<Row>) {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function addRow() {
    nextRowId.current += 1;
    setRows((current) => [
      ...current,
      {
        id: nextRowId.current,
        prizeTypeId: firstPrizeId,
        number: "",
        stake: "",
      },
    ]);
  }

  function removeRow(id: number) {
    setRows((current) => (current.length === 1 ? current : current.filter((row) => row.id !== id)));
  }

  const rowIssues = rows.map((row) => ({
    number: checkNumberField(row.number, digitsOf(row.prizeTypeId)),
    stake: checkStakeField(row.stake),
    row: checkRowComplete(row.number, row.stake),
  }));

  const hasFieldIssue = rowIssues.some((i) => i.number ?? i.stake ?? i.row);
  const filledRows = rows.filter((r) => r.number.trim() !== "" || r.stake.trim() !== "").length;
  const totalStake = rows.reduce((sum, row) => sum + (Number(row.stake) || 0), 0);

  return (
    <form action={formAction} className="bill-create-form">
      <div className="bill-form-fields">
      {representatives !== null && (
        <div className="agent-picker">
          <label htmlFor="representativeSearch">ผู้รับบิล / Agent</label>
          <AppDropdown
            id="representativeSearch"
            name="representativeUserId"
            value={selectedRepresentativeId}
            onValueChange={setSelectedRepresentativeId}
            placeholder="เลือกผู้รับบิล"
            searchPlaceholder="ค้นหาชื่อผู้ใช้งาน"
            emptyMessage="ไม่พบผู้ใช้งานที่เลือกได้"
            searchable
            required
            options={representatives.map((representative) => ({
              value: representative.id,
              label: representative.displayName,
              description: `${representative.role === "GODMODE" ? "Godmode" : representative.role === "OWNER" ? "Owner" : representative.role === "ADMIN" ? "Admin" : "Agent"}${representative.agent ? ` · ${representative.agent.code}` : " · ระบบจะสร้าง Agent ให้อัตโนมัติ"}`,
            }))}
          />
        </div>
      )}

      <CustomerNameCombobox names={customerNames} disabledHint={representatives !== null && !selectedRepresentativeId ? "เลือกผู้รับบิลก่อน เพื่อค้นหาลูกค้าเดิมของคนนั้น" : undefined} />

      <label htmlFor="drawId">
        งวด
        <AppDropdown id="drawId" name="drawId" defaultValue={draws[0]?.id ?? ""} required options={draws.map((draw) => ({ value: draw.id, label: draw.name, description: `ปิดรับ ${draw.cutoffAt}` }))} searchable={draws.length > 6} searchPlaceholder="ค้นหางวด" />
      </label>
      </div>

      <h2>รายการ</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">ประเภทรางวัล</th>
            <th scope="col">เลข</th>
            <th scope="col">ยอดเดิมพัน</th>
            <th scope="col"><span className="sr-only">จัดการแถว</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const issue = rowIssues[i];
            const requiredDigits = digitsOf(row.prizeTypeId);
            return (
              <tr key={row.id}>
                <td>
                  <AppDropdown
                    name="prizeTypeId"
                    value={row.prizeTypeId}
                    onValueChange={(prizeTypeId) => {
                      const digits = digitsOf(prizeTypeId);
                      updateRow(i, { prizeTypeId, number: row.number.slice(0, digits) });
                    }}
                    ariaLabel={`ประเภทรางวัล แถวที่ ${i + 1}`}
                    options={prizeTypes.map((prize) => ({ value: prize.id, label: `${prize.code}. ${prize.name}`, description: `${prize.digits} หลัก` }))}
                    searchable={prizeTypes.length > 6}
                    searchPlaceholder="ค้นหาประเภทรางวัล"
                  />
                </td>
                <td>
                  <input
                    name="number"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={requiredDigits}
                    value={row.number}
                    placeholder={`${requiredDigits} หลัก`}
                    onChange={(e) => updateRow(i, {
                      number: e.target.value.replace(/\D/g, "").slice(0, requiredDigits),
                    })}
                    aria-label={`เลข แถวที่ ${i + 1}`}
                    aria-invalid={issue?.number != null}
                  />
                  {issue?.number != null && <small className="error">{issue.number}</small>}
                </td>
                <td>
                  <input
                    name="stake"
                    inputMode="decimal"
                    min={MIN_STAKE_PER_ITEM}
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
                <td>
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => removeRow(row.id)}
                    disabled={rows.length === 1}
                    aria-label={`ลบแถวที่ ${i + 1}`}
                    title={rows.length === 1 ? "ต้องมีอย่างน้อย 1 แถว" : "ลบแถว"}
                  >
                    ลบ
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p>
        <button
          type="button"
          onClick={addRow}
        >
          เพิ่มแถว
        </button>
      </p>

      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="bill-form-footer"><div><span>สรุปบิล</span><strong>{totalStake.toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</strong><small>{filledRows} รายการ · ระบบจะตรวจวงเงินอีกครั้งตอนบันทึก</small></div><button
        type="submit"
        disabled={
          pending ||
          hasFieldIssue ||
          filledRows === 0 ||
          (representatives !== null && selectedRepresentativeId === "")
        }
      >
        {pending ? "กำลังบันทึก..." : "บันทึกเป็นร่าง"}
      </button></div>
    </form>
  );
}

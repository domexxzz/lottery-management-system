"use client";

import { useActionState, useRef, useState } from "react";
import { checkNumberField, checkRowComplete, checkStakeField } from "@/lib/bills/fieldChecks";
import { createBillAction, type ActionState } from "../actions";

const INITIAL: ActionState = { error: null };

export type DrawOption = { id: string; name: string; cutoffAt: string };
export type PrizeOption = { id: string; code: number; name: string; digits: number };
export type AgentOption = { id: string; code: string; name: string };

type Row = { id: number; prizeTypeId: string; number: string; stake: string };

export function BillForm({
  draws,
  prizeTypes,
  agents,
}: {
  draws: DrawOption[];
  prizeTypes: PrizeOption[];
  agents: AgentOption[] | null;
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
  const [agentSearch, setAgentSearch] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);

  const normalizedAgentSearch = agentSearch.trim().toLocaleLowerCase("th");
  const filteredAgents = (agents ?? []).filter((agent) =>
    `${agent.code} ${agent.name}`.toLocaleLowerCase("th").includes(normalizedAgentSearch),
  );

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

      {agents !== null && (
        <div className="agent-picker">
          <label htmlFor="agentSearch">Agent ที่เป็นเจ้าของบิล</label>
          <input type="hidden" name="agentId" value={selectedAgentId} />
          <input
            id="agentSearch"
            type="search"
            value={agentSearch}
            placeholder="ค้นหาด้วยรหัสหรือชื่อ Agent"
            autoComplete="off"
            role="combobox"
            aria-expanded={agentMenuOpen}
            aria-controls="agent-options"
            aria-autocomplete="list"
            onFocus={() => setAgentMenuOpen(true)}
            onBlur={() => setAgentMenuOpen(false)}
            onChange={(event) => {
              setAgentSearch(event.target.value);
              setSelectedAgentId("");
              setAgentMenuOpen(true);
            }}
          />
          {agentMenuOpen && (
            <div id="agent-options" className="agent-options" role="listbox">
              {filteredAgents.length === 0 ? (
                <p className="muted">ไม่พบ Agent ที่ค้นหา</p>
              ) : (
                filteredAgents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    role="option"
                    aria-selected={selectedAgentId === agent.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelectedAgentId(agent.id);
                      setAgentSearch(`${agent.code} — ${agent.name}`);
                      setAgentMenuOpen(false);
                    }}
                  >
                    <strong>{agent.code}</strong>
                    <span>{agent.name}</span>
                  </button>
                ))
              )}
            </div>
          )}
          {selectedAgentId === "" && agentSearch !== "" && (
            <small className="error">กรุณาเลือก Agent จากรายการ</small>
          )}
        </div>
      )}
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
            return (
              <tr key={row.id}>
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
          (agents !== null && selectedAgentId === "")
        }
      >
        {pending ? "กำลังบันทึก..." : "บันทึกเป็นร่าง"}
      </button></div>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { createAgentAction, setAgentStatusAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, ok: false };

export function CreateAgentForm() {
  const [state, formAction, pending] = useActionState(createAgentAction, INITIAL);

  return (
    <form action={formAction}>
      <label htmlFor="code">
        รหัส Agent
        <input id="code" name="code" required maxLength={20} placeholder="A004" />
      </label>

      <label htmlFor="name">
        ชื่อ Agent
        <input id="name" name="name" required maxLength={120} />
      </label>

      <label htmlFor="commissionRate">
        อัตราคอมมิชชัน (%)
        <input
          id="commissionRate"
          name="commissionRate"
          required
          inputMode="decimal"
          placeholder="25"
        />
      </label>

      <label htmlFor="creditLimit">
        วงเงินรวมต่อรอบ
        <input id="creditLimit" name="creditLimit" inputMode="decimal" placeholder="เว้นว่าง = ไม่จำกัด" />
      </label>

      <label htmlFor="perNumberLimit">
        วงเงินต่อเลข
        <input
          id="perNumberLimit"
          name="perNumberLimit"
          inputMode="decimal"
          placeholder="เว้นว่าง = ไม่จำกัด"
        />
      </label>

      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      {state.ok && <p role="status">บันทึก Agent แล้ว</p>}

      <button type="submit" disabled={pending}>
        {pending ? "กำลังบันทึก..." : "เพิ่ม Agent"}
      </button>
    </form>
  );
}

export function StatusForm({
  agentId,
  currentStatus,
}: {
  agentId: string;
  currentStatus: string;
}) {
  const [state, formAction, pending] = useActionState(setAgentStatusAction, INITIAL);
  const nextStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const label = nextStatus === "SUSPENDED" ? "ระงับ" : "เปิดใช้งาน";

  return (
    <form action={formAction}>
      <input type="hidden" name="agentId" value={agentId} />
      <input type="hidden" name="status" value={nextStatus} />
      <input
        name="reason"
        required
        maxLength={200}
        aria-label={`เหตุผลในการ${label}`}
        placeholder="เหตุผล"
      />
      {state.error !== null && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending}>
        {pending ? "กำลังบันทึก..." : label}
      </button>
    </form>
  );
}

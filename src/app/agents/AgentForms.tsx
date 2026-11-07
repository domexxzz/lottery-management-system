"use client";

import { useActionState } from "react";
import { setAgentStatusAction, type ActionState } from "./actions";

const INITIAL: ActionState = { error: null, ok: false };

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

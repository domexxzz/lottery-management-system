"use client";

import { useActionState, useState } from "react";
import { createUserAction, setUserStatusAction, updateUserIdentityAction, type UserActionState } from "./actions";

const INITIAL: UserActionState = { error: null, ok: false };

export function CreateUserForm() {
  const [role, setRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [state, action, pending] = useActionState(createUserAction, INITIAL);
  return <form action={action} className="user-create-form">
    <label>บทบาท<select name="role" value={role} onChange={(event) => setRole(event.target.value as "ADMIN" | "AGENT")}><option value="AGENT">Agent — ขายและดูบิลของตนเอง</option><option value="ADMIN">Admin — ตรวจหลักฐานและจัดการงวด</option></select></label>
    <label>ชื่อผู้ใช้<input name="login" required maxLength={64} autoComplete="off" placeholder="เช่น agent04" /></label>
    <label>ชื่อที่แสดง<input name="displayName" required maxLength={120} placeholder="ชื่อผู้ใช้งาน" /></label>
    <label>รหัสผ่านชั่วคราว<input name="password" type="password" required maxLength={256} autoComplete="new-password" placeholder="อย่างน้อย 10 ตัว มีตัวอักษรและตัวเลข" /></label>
    {role === "AGENT" && <fieldset className="agent-account-fields"><legend>ข้อมูล Agent</legend><label>รหัส Agent<input name="agentCode" required maxLength={20} placeholder="A004" /></label><label>คอมมิชชัน (%)<input name="commissionRate" required inputMode="decimal" value="30" readOnly aria-describedby="agent-commission-help" /><small id="agent-commission-help">คิด 30% จากยอดเดิมพันรวม</small></label><label>วงเงินรวมต่องวด<input name="creditLimit" inputMode="decimal" placeholder="เว้นว่าง = ไม่จำกัด" /></label><label>วงเงินต่อเลข<input name="perNumberLimit" inputMode="decimal" placeholder="เว้นว่าง = ไม่จำกัด" /></label></fieldset>}
    <p className="user-form-note">บัญชีใหม่จะถูกบังคับให้เปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก</p>
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.ok && <p className="success" role="status">สร้างบัญชีเรียบร้อยแล้ว</p>}
    <button type="submit" disabled={pending}>{pending ? "กำลังสร้างบัญชี..." : `สร้างบัญชี ${role === "ADMIN" ? "Admin" : "Agent"}`}</button>
  </form>;
}

export function UserStatusForm({ userId, currentStatus }: { userId: string; currentStatus: string }) {
  const [state, action, pending] = useActionState(setUserStatusAction, INITIAL);
  const nextStatus = currentStatus === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
  const label = nextStatus === "SUSPENDED" ? "ระงับสิทธิ์" : "เปิดใช้งาน";
  return <form action={action} className="user-status-form">
    <input type="hidden" name="userId" value={userId} /><input type="hidden" name="status" value={nextStatus} />
    <input name="reason" required maxLength={200} placeholder={`เหตุผลที่${label}`} aria-label={`เหตุผลที่${label}`} />
    {state.error && <small className="error" role="alert">{state.error}</small>}
    <button type="submit" className={nextStatus === "SUSPENDED" ? "danger" : "secondary"} disabled={pending}>{pending ? "กำลังบันทึก..." : label}</button>
  </form>;
}

export function UserIdentityForm({ userId, login, displayName }: { userId: string; login: string; displayName: string }) {
  const [state, action, pending] = useActionState(updateUserIdentityAction, INITIAL);
  return <details className="user-identity-editor">
    <summary>แก้ชื่อ / ชื่อผู้ใช้</summary>
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <label>ชื่อผู้ใช้<input name="login" defaultValue={login} required maxLength={64} /></label>
      <label>ชื่อที่แสดง<input name="displayName" defaultValue={displayName} required maxLength={120} /></label>
      <label>เหตุผล<input name="reason" required maxLength={200} placeholder="ระบุสาเหตุเพื่อ Audit Log" /></label>
      {state.error && <small className="error" role="alert">{state.error}</small>}
      {state.ok && <small className="success" role="status">บันทึกแล้ว</small>}
      <button type="submit" disabled={pending}>{pending ? "กำลังบันทึก..." : "บันทึกการแก้ไข"}</button>
    </form>
  </details>;
}

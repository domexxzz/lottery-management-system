"use client";

import { useActionState, useState } from "react";
import {
  createUserAction,
  deleteUserAction,
  setUserPasswordAction,
  setUserStatusAction,
  updateUserIdentityAction,
  type UserActionState,
} from "./actions";

const INITIAL: UserActionState = { error: null, ok: false };

/** ชื่อผู้ใช้และรหัสผ่านที่เพิ่งตั้ง พร้อมปุ่มคัดลอกไปส่งให้เจ้าของบัญชี */
function CredentialsCard({ login, password }: { login: string; password: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(`ชื่อผู้ใช้: ${login}\nรหัสผ่าน: ${password}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return <div className="user-credentials" role="status">
    <div><span>ชื่อผู้ใช้</span><strong>{login}</strong></div>
    <div><span>รหัสผ่าน</span><strong>{password}</strong></div>
    <button type="button" onClick={copy}>{copied ? "คัดลอกแล้ว ✓" : "คัดลอก"}</button>
    <small>ระบบไม่เก็บรหัสผ่านไว้ให้ดูภายหลัง คัดลอกส่งให้เจ้าของบัญชีตอนนี้ ถ้าลืมให้ตั้งใหม่ได้ทุกเมื่อ</small>
  </div>;
}

export function CreateUserForm({ nextAgentLogin }: { nextAgentLogin: string }) {
  const [role, setRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [state, action, pending] = useActionState(createUserAction, INITIAL);
  const isAgent = role === "AGENT";
  return <form action={action} className="user-create-form">
    <label>บทบาท<select name="role" value={role} onChange={(event) => setRole(event.target.value as "ADMIN" | "AGENT")}><option value="AGENT">Agent — ขายและดูบิลของตนเอง</option><option value="ADMIN">Admin — ตรวจหลักฐานและจัดการงวด</option></select></label>
    {isAgent ? (
      <div className="user-auto-identity">
        <div><span>ชื่อผู้ใช้</span><strong>{nextAgentLogin}</strong></div>
        <div><span>รหัส Agent</span><strong>{nextAgentLogin}</strong></div>
        <small>ระบบตั้งให้อัตโนมัติ เรียงต่อกันไป A1, A2, A3 …</small>
      </div>
    ) : (
      <label>ชื่อผู้ใช้<input name="login" required maxLength={64} autoComplete="off" placeholder="เช่น admin2" /><small className="user-field-hint">ภาษาอังกฤษตัวเล็ก ตัวเลข จุด หรือขีด อย่างน้อย 3 ตัว</small></label>
    )}
    <label>ชื่อที่แสดง<input name="displayName" required maxLength={120} placeholder={isAgent ? "เช่น ตัวแทน โคราช, พี่เบส" : "เช่น แอดมินบัญชี"} /><small className="user-field-hint">ชื่อนี้จะแสดงในบิล รายงาน และรายชื่อ Agent</small></label>
    <label>รหัสผ่าน<input name="password" type="text" required maxLength={256} autoComplete="off" spellCheck={false} placeholder="ตั้งได้ตามต้องการ" /><small className="user-field-hint">ไม่มีข้อกำหนด ตั้งอะไรก็ได้ เจ้าของบัญชีใช้รหัสนี้เข้าได้เลย</small></label>
    {isAgent && <fieldset className="agent-account-fields"><legend>ข้อมูล Agent</legend><label>คอมมิชชัน (%)<input name="commissionRate" inputMode="decimal" value="30" readOnly aria-describedby="agent-commission-help" /><small id="agent-commission-help">คิด 30% จากยอดเดิมพันรวม</small></label><label>วงเงินรวมต่องวด<input name="creditLimit" inputMode="decimal" placeholder="เว้นว่าง = ไม่จำกัด" /></label><label>วงเงินต่อเลข<input name="perNumberLimit" inputMode="decimal" placeholder="เว้นว่าง = ไม่จำกัด" /></label></fieldset>}
    {state.error && <p className="error" role="alert">{state.error}</p>}
    {state.ok && state.message && <p className="success" role="status">{state.message}</p>}
    {state.ok && state.credentials && <CredentialsCard login={state.credentials.login} password={state.credentials.password} />}
    <button type="submit" disabled={pending}>{pending ? "กำลังสร้างบัญชี..." : `สร้างบัญชี ${isAgent ? "Agent" : "Admin"}`}</button>
  </form>;
}

/** คำแนะนำสำหรับ Owner อ่านก่อนสร้างหรือจัดการบัญชี */
export function AccountGuide() {
  return <details className="user-guide" open>
    <summary>วิธีใช้งาน</summary>
    <ol>
      <li><b>ชื่อผู้ใช้และรหัส Agent</b> ระบบตั้งให้อัตโนมัติเรียงกัน A1, A2, A3 … ไม่ต้องคิดเอง เข้าสู่ระบบจะพิมพ์ A1 หรือ a1 ก็ได้</li>
      <li><b>ชื่อที่แสดง</b> ตั้งเป็นชื่อที่เรียกกันจริง เช่น &ldquo;ตัวแทน โคราช&rdquo; หรือ &ldquo;พี่เบส&rdquo; ชื่อนี้จะขึ้นในบิลและรายงาน</li>
      <li><b>รหัสผ่าน</b> ตั้งอะไรก็ได้ ไม่มีข้อกำหนด เจ้าของบัญชีเข้าใช้ได้ทันทีโดยไม่ต้องเปลี่ยนรหัส</li>
      <li><b>ดูรหัสผ่าน</b> จะเห็นทันทีหลังสร้างหรือหลังตั้งใหม่ พร้อมปุ่มคัดลอก ระบบไม่เก็บรหัสผ่านไว้ให้เปิดดูภายหลัง เพื่อความปลอดภัยถ้าข้อมูลรั่ว</li>
      <li><b>ลืมรหัสผ่าน</b> กด &ldquo;ตั้งรหัสผ่านใหม่&rdquo; ที่แถวของบัญชีนั้น ตั้งแล้วบัญชีนั้นจะถูกออกจากระบบทุกเครื่องและต้องใช้รหัสใหม่</li>
      <li><b>ระงับสิทธิ์</b> ปิดการเข้าใช้ชั่วคราว เปิดกลับได้ภายหลัง</li>
      <li><b>ลบบัญชี</b> บัญชีที่ยังไม่เคยใช้งานจะถูกลบทิ้ง ส่วนบัญชีที่มีบิลแล้วจะถูกซ่อนและเข้าใช้ไม่ได้ แต่บิลและรายงานเดิมยังอยู่ครบ และเลข A ของบัญชีนั้นจะไม่ถูกนำกลับมาใช้</li>
    </ol>
  </details>;
}

export function UserPasswordForm({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState(setUserPasswordAction, INITIAL);
  return <details className="user-row-editor">
    <summary>ตั้งรหัสผ่านใหม่</summary>
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <label>รหัสผ่านใหม่ของ {name}<input name="password" type="text" required maxLength={256} autoComplete="off" spellCheck={false} placeholder="ตั้งได้ตามต้องการ" /></label>
      {state.error && <small className="error" role="alert">{state.error}</small>}
      {state.ok && state.credentials && <CredentialsCard login={state.credentials.login} password={state.credentials.password} />}
      <button type="submit" disabled={pending}>{pending ? "กำลังบันทึก..." : "บันทึกรหัสผ่าน"}</button>
    </form>
  </details>;
}

export function UserDeleteForm({ userId, name }: { userId: string; name: string }) {
  const [state, action, pending] = useActionState(deleteUserAction, INITIAL);
  return <details className="user-row-editor is-danger">
    <summary>ลบบัญชี</summary>
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      <p>ลบบัญชี <b>{name}</b>? บัญชีจะเข้าใช้ไม่ได้อีก ถ้ามีบิลแล้วระบบจะเก็บประวัติบิลและรายงานไว้</p>
      {state.error && <small className="error" role="alert">{state.error}</small>}
      <button type="submit" className="danger" disabled={pending}>{pending ? "กำลังลบ..." : "ยืนยันลบบัญชี"}</button>
    </form>
  </details>;
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

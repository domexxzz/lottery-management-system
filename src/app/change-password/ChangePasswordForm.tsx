"use client";

import Link from "next/link";
import { useActionState } from "react";
import { DashboardIcon } from "../DashboardIcon";
import { changePasswordAction, type ChangePasswordState } from "./actions";

const INITIAL: ChangePasswordState = { error: null };

export function ChangePasswordForm({ forced }: { forced: boolean }) {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL);

  return <main className={forced ? "auth-page password-page is-forced" : "password-settings-page"}>
    <section className="card auth-card password-settings-card" aria-labelledby="cp-heading">
      <div className="auth-brand"><span><DashboardIcon name="lock" /></span><div><strong>ความปลอดภัยของบัญชี</strong><small>CHANGE PASSWORD</small></div></div>
      <h1 id="cp-heading">เปลี่ยนรหัสผ่าน</h1>
      <p className="muted">
        {forced
          ? "ต้องเปลี่ยนรหัสผ่านก่อนใช้งานครั้งแรก เมื่อเปลี่ยนแล้วระบบจะให้เข้าสู่ระบบใหม่"
          : "กรอกรหัสผ่านปัจจุบัน แล้วตั้งรหัสผ่านใหม่ของบัญชีนี้ หลังบันทึกระบบจะออกจากระบบทุกอุปกรณ์"}
      </p>

      <form action={formAction}>
        <label htmlFor="currentPassword">รหัสผ่านปัจจุบัน
          <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required autoFocus />
        </label>

        <label htmlFor="newPassword">รหัสผ่านใหม่
          <input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required aria-describedby="password-rule" />
        </label>
        <p id="password-rule" className="password-rule">อย่างน้อย 10 ตัวอักษร และต้องมีทั้งตัวอักษรและตัวเลข</p>

        <label htmlFor="confirmPassword">ยืนยันรหัสผ่านใหม่
          <input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
        </label>

        {state.error !== null && <p className="error password-message" role="alert">{state.error}</p>}

        <div className="password-actions">
          {!forced && <Link href="/">ยกเลิก</Link>}
          <button type="submit" disabled={pending}>{pending ? "กำลังบันทึก..." : "เปลี่ยนรหัสผ่าน"}</button>
        </div>
      </form>
    </section>
  </main>;
}

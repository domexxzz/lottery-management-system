"use client";

import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "./actions";
import { DashboardIcon } from "../DashboardIcon";

const INITIAL: ChangePasswordState = { error: null };

/*
 * ทุกหน้าในแอปนี้ผูกกับ session ของผู้ใช้ จึงต้องไม่ถูกทำเป็น static
 *
 * นอกจากเรื่องความถูกต้องแล้ว ยังตัดงาน static generation ตอน build ออกด้วย
 * ซึ่งเป็นขั้นที่กินหน่วยความจำจนถูก OOM killer ฆ่าบนเครื่อง build ขนาดเล็ก
 */
export const dynamic = "force-dynamic";

export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState(changePasswordAction, INITIAL);

  return (
    <main className="auth-page">
      <section className="card auth-card" aria-labelledby="cp-heading">
        <div className="auth-brand"><span><DashboardIcon name="brand" /></span><div><strong>ระบบจัดการหวย</strong><small>SECURITY</small></div></div>
        <h1 id="cp-heading">เปลี่ยนรหัสผ่าน</h1>
        <p className="muted">
          ต้องเปลี่ยนรหัสผ่านก่อนใช้งานครั้งแรก เมื่อเปลี่ยนแล้วระบบจะให้เข้าสู่ระบบใหม่
        </p>

        <form action={formAction}>
          <label htmlFor="currentPassword">
            รหัสผ่านปัจจุบัน
            <input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          <label htmlFor="newPassword">
            รหัสผ่านใหม่
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              required
              aria-describedby="password-rule"
            />
          </label>
          <p id="password-rule" className="muted">
            อย่างน้อย 10 ตัวอักษร และต้องมีทั้งตัวอักษรและตัวเลข
          </p>

          <label htmlFor="confirmPassword">
            ยืนยันรหัสผ่านใหม่
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
            />
          </label>

          {state.error !== null && (
            <p className="error" role="alert">
              {state.error}
            </p>
          )}

          <button type="submit" disabled={pending}>
            {pending ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
          </button>
        </form>
      </section>
    </main>
  );
}

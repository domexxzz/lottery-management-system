"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <main className="auth-page">
      <section className="card auth-card" aria-labelledby="login-heading">
        <div className="auth-brand"><span>ล</span><div><strong>ระบบจัดการหวย</strong><small>LOTTERY MANAGEMENT</small></div></div>
        <p className="page-eyebrow">ยินดีต้อนรับกลับ</p>
        <h1 id="login-heading">เข้าสู่ระบบ</h1>
        <p className="muted">เข้าสู่ระบบเพื่อจัดการงานตามสิทธิ์ของคุณ</p>

        <form action={formAction}>
          <label htmlFor="login">
            ชื่อผู้ใช้
            <input id="login" name="login" autoComplete="username" required />
          </label>

          <label htmlFor="password">
            รหัสผ่าน
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>

          {state.error !== null && (
            <p className="error" role="alert">
              {state.error}
            </p>
          )}

          <button type="submit" disabled={pending}>
            {pending ? "กำลังตรวจสอบ..." : "เข้าสู่ระบบ"}
          </button>
        </form>
      </section>
    </main>
  );
}

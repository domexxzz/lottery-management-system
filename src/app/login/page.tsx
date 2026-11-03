"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const INITIAL: LoginState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, INITIAL);

  return (
    <main>
      <section className="card" aria-labelledby="login-heading">
        <h1 id="login-heading">เข้าสู่ระบบ</h1>
        <p className="muted">ระบบบริหารจัดการลอตเตอรี่</p>

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

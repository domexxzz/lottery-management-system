"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, revokeSession } from "@/lib/auth/session";

export async function logoutAction(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    await revokeSession(token);
  }
  store.delete(SESSION_COOKIE_NAME);

  redirect("/login");
}

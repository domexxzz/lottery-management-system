import type { Metadata } from "next";
import { getActor } from "@/lib/auth/context";
import { AppShell } from "./AppShell";
import "./globals.css";
import "./home.css";

export const metadata: Metadata = {
  title: "ระบบบริหารจัดการลอตเตอรี่",
  description: "Agent, บิล, ปิดรอบ, ลงผล และสรุปการเงินแยกตาม Agent",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  return (
    <html lang="th">
      <body>
        {actor !== null && !actor.mustChangePassword ? (
          <AppShell displayName={actor.displayName} role={actor.role}>
            {children}
          </AppShell>
        ) : (
          children
        )}
      </body>
    </html>
  );
}

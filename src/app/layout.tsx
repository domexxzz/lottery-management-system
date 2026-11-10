import type { Metadata } from "next";
import localFont from "next/font/local";
import { getActor } from "@/lib/auth/context";
import { AppShell } from "./AppShell";
import "./globals.css";
import "./home.css";
import "./premium-theme.css";
import "@/components/calendar/calendar.css";
import "./mobile-ux.css";

const sarabun = localFont({
  variable: "--font-sarabun",
  display: "swap",
  // ใช้เฉพาะน้ำหนักที่หน้าจอใช้จริง เดิมโหลด 16 ไฟล์รวมตัวเอียงและน้ำหนักบางที่ไม่ได้ใช้
  src: [
    { path: "./fonts/Sarabun-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Sarabun-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Sarabun-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Sarabun-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Sarabun-ExtraBold.ttf", weight: "800", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "ระบบบริหารจัดการลอตเตอรี่",
  description: "Agent, บิล, ปิดงวด, ลงผล และสรุปการเงินแยกตาม Agent",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  return (
    <html lang="th" className={sarabun.variable} data-theme="light">
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

import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ระบบบริหารจัดการลอตเตอรี่",
  description: "Agent, บิล, ปิดรอบ, ลงผล และสรุปการเงินแยกตาม Agent",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}

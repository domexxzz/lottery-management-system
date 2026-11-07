import type { Metadata } from "next";
import localFont from "next/font/local";
import { getActor } from "@/lib/auth/context";
import { AppShell } from "./AppShell";
import "./globals.css";
import "./home.css";
import "./premium-theme.css";

const sarabun = localFont({
  variable: "--font-sarabun",
  display: "swap",
  src: [
    { path: "./fonts/Sarabun-Thin.ttf", weight: "100", style: "normal" },
    { path: "./fonts/Sarabun-ThinItalic.ttf", weight: "100", style: "italic" },
    { path: "./fonts/Sarabun-ExtraLight.ttf", weight: "200", style: "normal" },
    { path: "./fonts/Sarabun-ExtraLightItalic.ttf", weight: "200", style: "italic" },
    { path: "./fonts/Sarabun-Light.ttf", weight: "300", style: "normal" },
    { path: "./fonts/Sarabun-LightItalic.ttf", weight: "300", style: "italic" },
    { path: "./fonts/Sarabun-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/Sarabun-Italic.ttf", weight: "400", style: "italic" },
    { path: "./fonts/Sarabun-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/Sarabun-MediumItalic.ttf", weight: "500", style: "italic" },
    { path: "./fonts/Sarabun-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/Sarabun-SemiBoldItalic.ttf", weight: "600", style: "italic" },
    { path: "./fonts/Sarabun-Bold.ttf", weight: "700", style: "normal" },
    { path: "./fonts/Sarabun-BoldItalic.ttf", weight: "700", style: "italic" },
    { path: "./fonts/Sarabun-ExtraBold.ttf", weight: "800", style: "normal" },
    { path: "./fonts/Sarabun-ExtraBoldItalic.ttf", weight: "800", style: "italic" },
  ],
});

export const metadata: Metadata = {
  title: "ระบบบริหารจัดการลอตเตอรี่",
  description: "Agent, บิล, ปิดงวด, ลงผล และสรุปการเงินแยกตาม Agent",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const actor = await getActor();

  return (
    <html lang="th" className={sarabun.variable}>
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

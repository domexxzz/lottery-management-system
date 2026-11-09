"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type MockDataToggleProps = {
  initialEnabled: boolean;
  canManage: boolean;
};

export function MockDataToggle({ initialEnabled, canManage }: MockDataToggleProps) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const enabledRef = useRef(initialEnabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    const controller = new AbortController();
    async function synchronize() {
      try {
        const response = await fetch("/api/mock-data", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const data = await response.json() as { enabled: boolean };
        if (data.enabled !== enabledRef.current) {
          enabledRef.current = data.enabled;
          setEnabled(data.enabled);
          // หน่วงแบบสุ่มเล็กน้อย ไม่ให้ทุกแท็บในองค์กรโหลดหน้าใหม่พร้อมกันในวินาทีเดียว
          window.setTimeout(() => router.refresh(), Math.random() * 1500);
        }
      } catch {
        // การ polling เป็นเพียงการซิงก์หน้าที่เปิดค้างไว้ ไม่รบกวนผู้ใช้เมื่อเครือข่ายสะดุด
      }
    }
    // ตรวจเฉพาะตอนแท็บแสดงอยู่ แท็บที่ซ่อนไว้ไม่ต้องยิงทุก 8 วินาที กลับมาเมื่อไรตรวจทันที
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void synchronize();
    }, 8_000);
    const onVisible = () => { if (document.visibilityState === "visible") void synchronize(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  async function toggle() {
    if (!canManage || busy) return;
    const confirmed = window.confirm(
      `${enabled ? "ปิด" : "เปิด"}ข้อมูลจำลองหรือไม่? การเปลี่ยนสถานะนี้มีผลต่อข้อมูลที่ทุกบัญชีในองค์กรเห็น`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/mock-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !enabled }),
      });
      const data = await response.json() as { enabled?: boolean; error?: { message?: string } };
      if (!response.ok || typeof data.enabled !== "boolean") {
        throw new Error(data.error?.message ?? "เปลี่ยนสถานะข้อมูลจำลองไม่สำเร็จ");
      }
      enabledRef.current = data.enabled;
      setEnabled(data.enabled);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เปลี่ยนสถานะข้อมูลจำลองไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mock-data-control" data-enabled={enabled}>
      <div>
        <strong>ข้อมูลจำลอง <span className="mock-data-state">{enabled ? "เปิดอยู่" : "ปิดอยู่"}</span></strong>
        <small id="mock-data-impact">{busy ? "กำลังประมวลผล 2,000 บิล…" : "มีผลทั้งองค์กร"}</small>
      </div>
      {canManage ? (
        <button type="button" role="switch" aria-checked={enabled} aria-describedby="mock-data-impact" aria-label={`${enabled ? "ปิด" : "เปิด"}ข้อมูลจำลองสำหรับทุกบัญชี`} disabled={busy} onClick={toggle}>
          <span aria-hidden="true" />
        </button>
      ) : <span className="mock-data-readonly">{enabled ? "ON" : "OFF"}</span>}
      {error && <span className="mock-data-error" role="alert">{error}</span>}
    </div>
  );
}

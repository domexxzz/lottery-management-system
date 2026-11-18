"use client";

/**
 * ตัวช่วยความปลอดภัยของหน้าสร้างบิล
 * - รหัสการกดยืนยัน (กันบิลซ้ำ)
 * - ร่างบิลในเครื่อง (กันรายการหายตอนปิดแอป/เน็ตหลุด)
 * - เวลา Server (นับถอยหลังปิดรับไม่ขึ้นกับนาฬิกามือถือ)
 */

import { useEffect, useState } from "react";
import type { BetEntry } from "@/lib/bills/betting";

/** รหัสสุ่ม 32 ตัว ใช้ randomUUID ไม่ได้เมื่อเปิดผ่าน http ด้วย IP ในวง LAN (ไม่ใช่ secure context) */
export function newSubmissionKey(): string {
  if (typeof crypto.randomUUID === "function" && window.isSecureContext) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

/** รายการในบิล พร้อมงวดของรายการนั้น (บิลเดียวมีได้หลายประเภทหวย) */
export type SlipEntry = BetEntry & { drawId: string };

export type SlipDraft = {
  version: 2;
  entries: SlipEntry[];
  /** ประเภทหวยที่เปิดอยู่ตอนบันทึก */
  activeType: string;
  title: string;
  representativeId: string;
  submissionKey: string;
  savedAt: number;
};

/** ร่างเก่ากว่านี้ไม่ถามกู้คืน งวดน่าจะผ่านไปแล้ว */
const DRAFT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export function draftStorageKey(scope: string): string {
  return `lottery:bill-draft:${scope}`;
}

export function readDraft(scope: string): SlipDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey(scope));
    if (!raw) return null;
    const draft = JSON.parse(raw) as SlipDraft | (Omit<SlipDraft, "version" | "entries" | "activeType"> & { version: 1; drawId: string; entries: BetEntry[] });
    if (!draft || (draft.version !== 1 && draft.version !== 2) || !Array.isArray(draft.entries) || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
      window.localStorage.removeItem(draftStorageKey(scope));
      return null;
    }
    // ร่างรุ่นเดิมมีงวดเดียวที่ระดับบิล แปลงให้ทุกรายการรู้งวดของตัวเอง
    const rawEntries: SlipEntry[] = draft.version === 1
      ? draft.entries.map((entry) => ({ ...entry, drawId: draft.drawId }))
      : draft.entries;
    const entries = rawEntries.filter((entry) =>
      typeof entry?.prizeTypeId === "string" && typeof entry.drawId === "string" && /^\d{1,6}$/.test(entry.number) && Number.isInteger(entry.stake) && entry.stake > 0);
    return {
      version: 2,
      entries,
      activeType: draft.version === 2 ? draft.activeType : "",
      title: draft.title,
      representativeId: draft.representativeId,
      submissionKey: draft.submissionKey,
      savedAt: draft.savedAt,
    };
  } catch {
    return null;
  }
}

export function writeDraft(scope: string, draft: SlipDraft): void {
  try {
    window.localStorage.setItem(draftStorageKey(scope), JSON.stringify(draft));
  } catch {
    // พื้นที่เต็มหรือโหมดส่วนตัว: ไม่มีร่างก็ยังทำงานต่อได้
  }
}

export function clearDraft(scope: string): void {
  try {
    window.localStorage.removeItem(draftStorageKey(scope));
  } catch {
    // ignore
  }
}

/**
 * ส่วนต่างเวลา Server − เครื่อง (ms)
 * ค่าแรกจากเวลาที่ Server render หน้า แล้วซิงก์ซ้ำจาก /api/health หักครึ่งหนึ่งของเวลาเดินทางของคำขอ
 * ซิงก์ใหม่ทุกครั้งที่กลับมาที่แอป เพราะมือถือที่หลับไปนาน ๆ นาฬิกาอาจถูกปรับระหว่างนั้น
 */
export function useServerClockOffset(renderedAt: number): number {
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const fromRender = renderedAt - Date.now();
    const initial = window.setTimeout(() => { if (!cancelled) setOffset(fromRender); }, 0);
    async function sync() {
      try {
        const started = Date.now();
        const response = await fetch("/api/health", { cache: "no-store" });
        const ended = Date.now();
        const body = await response.json() as { time?: number };
        if (cancelled || typeof body.time !== "number" || ended - started > 10_000) return;
        setOffset(body.time + (ended - started) / 2 - ended);
      } catch {
        // ใช้ค่าจากเวลา render ต่อไป
      }
    }
    void sync();
    const onVisible = () => { if (document.visibilityState === "visible") void sync(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      cancelled = true;
      window.clearTimeout(initial);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [renderedAt]);
  return offset;
}

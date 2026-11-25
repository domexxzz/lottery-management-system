"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type EvidenceDrawCount = { drawId: string; label: string; count: number };

const COUNT = new Intl.NumberFormat("th-TH");

/**
 * ปุ่มลบหลักฐานทั้งหมด (Owner/Admin)
 *
 * ลบทุกรูปไม่ว่าจะรอตรวจ ผ่าน หรือตีกลับ ไม่ใช่การตีกลับ
 * กดแล้วต้องยืนยันอีกครั้งในหน้าต่างที่บอกว่ามีงวดไหนบ้าง งวดละกี่รูป
 */
export function DeleteAllEvidence({ total, draws }: { total: number; draws: EvidenceDrawCount[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true);
    setError(null);
    const response = await fetch("/api/evidence/delete-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedTotal: total }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "ลบหลักฐานไม่สำเร็จ");
      router.refresh();
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" className="danger-button evidence-delete-all" disabled={total === 0} onClick={() => { setError(null); setOpen(true); }}>
        ลบหลักฐานทั้งหมด{total > 0 ? ` (${COUNT.format(total)} รูป)` : ""}
      </button>
      {open && (
        <div className="evidence-delete-all-modal" role="dialog" aria-modal="true" aria-labelledby="delete-all-heading" onClick={() => !busy && setOpen(false)}>
          <section onClick={(event) => event.stopPropagation()}>
            <h2 id="delete-all-heading">ยืนยันลบหลักฐานทั้งหมด</h2>
            <p>
              ระบบจะลบรูปหลักฐาน <strong>{COUNT.format(total)} รูป</strong> ทุกรูปถาวร ทั้งที่รอตรวจ ตรวจผ่านแล้ว และถูกตีกลับ
              ลบแล้วกู้คืนไม่ได้ (บิลและยอดเงินไม่ถูกแตะ และระบบจะบันทึกการลบไว้ในประวัติ)
            </p>
            <h3>งวดที่จะลบ</h3>
            <ul>
              {draws.map((draw) => (
                <li key={draw.drawId}><span>{draw.label}</span><b>{COUNT.format(draw.count)} รูป</b></li>
              ))}
            </ul>
            {error && <p className="error" role="alert">{error}</p>}
            <footer>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => setOpen(false)}>ยกเลิก</button>
              <button type="button" className="danger-button" disabled={busy} onClick={confirmDelete}>
                {busy ? "กำลังลบ..." : `ยืนยันลบทั้งหมด ${COUNT.format(total)} รูป`}
              </button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

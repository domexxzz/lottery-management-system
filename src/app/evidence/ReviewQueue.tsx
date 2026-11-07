"use client";

/* eslint-disable @next/next/no-img-element -- private signed previews require the authenticated redirect route */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export type ReviewItem = {
  id: string;
  type: "ORDER_EVIDENCE" | "PAYMENT_EVIDENCE" | "OTHER";
  originalName: string;
  fileSize: number;
  status: "PENDING" | "VERIFIED" | "REJECTED";
  rejectionReason: string | null;
  createdAt: string;
  verifiedAt: string | null;
  uploadedBy: string;
  verifiedBy: string | null;
  bill: { id: string; billNumber: string | null; title: string; status: string; agentCode: string; agentName: string; drawName: string };
  payment: null | { amount: string; paidAt: string; paymentMethod: string; note: string | null; verificationStatus: string };
};

const typeLabel = { ORDER_EVIDENCE: "หลักฐานการสั่งซื้อ", PAYMENT_EVIDENCE: "หลักฐานการชำระเงิน", OTHER: "หลักฐานอื่น" } as const;
const statusLabel = { PENDING: "รอตรวจสอบ", VERIFIED: "ตรวจสอบผ่าน", REJECTED: "ถูกตีกลับ" } as const;

export function ReviewQueue({ items, emptyTitle = "ไม่มีหลักฐานตามตัวกรองนี้", emptyDescription = "เมื่อ Agent ส่งบิลพร้อมหลักฐาน รายการจะปรากฏที่นี่" }: { items: ReviewItem[]; emptyTitle?: string; emptyDescription?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReviewItem | null>(null);
  const [history, setHistory] = useState<{ billId: string; rows: Array<{ id: string; action: string; reason: string | null; createdAt: string; actor: { displayName: string; role: string } | null }> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reject(item: ReviewItem) {
    const reason = window.prompt("ระบุเหตุผลที่ตีกลับหลักฐาน");
    if (!reason?.trim()) return;
    setBusy(item.id);
    setError(null);
    const response = await fetch(`/api/attachments/${item.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "ดำเนินการไม่สำเร็จ");
      return;
    }
    router.refresh();
  }

  async function verifyBill(billId: string, pendingCount: number) {
    if (!window.confirm(`ยืนยันหลักฐานที่รอตรวจทั้ง ${pendingCount} รายการของบิลนี้ใช่หรือไม่`)) return;
    setBusy(`bill:${billId}`);
    setError(null);
    const response = await fetch(`/api/bills/${billId}/evidence/verify`, { method: "POST" });
    setBusy(null);
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "ยืนยันหลักฐานทั้งบิลไม่สำเร็จ");
      return;
    }
    router.refresh();
  }

  async function loadHistory(billId: string) {
    const response = await fetch(`/api/bills/${billId}/evidence/history`, { cache: "no-store" });
    if (!response.ok) return setError("โหลดประวัติการตรวจไม่สำเร็จ");
    const body = await response.json() as { data: Array<{ id: string; action: string; reason: string | null; createdAt: string; actor: { displayName: string; role: string } | null }> };
    setHistory({ billId, rows: body.data });
  }

  const billGroups = useMemo(() => {
    const grouped = new Map<string, { bill: ReviewItem["bill"]; items: ReviewItem[] }>();
    for (const item of items) {
      const current = grouped.get(item.bill.id);
      if (current) current.items.push(item);
      else grouped.set(item.bill.id, { bill: item.bill, items: [item] });
    }
    return [...grouped.values()];
  }, [items]);

  if (items.length === 0) return <div className="review-empty"><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>;

  return <>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="review-bill-list">{billGroups.map((group) => {
      const pendingCount = group.items.filter((item) => item.status === "PENDING").length;
      const verifiedCount = group.items.filter((item) => item.status === "VERIFIED").length;
      const rejectedCount = group.items.filter((item) => item.status === "REJECTED").length;
      return <section key={group.bill.id} className="review-bill-group">
        <header className="review-bill-header">
          <div><p>หลักฐานของบิลเดียวกัน</p><h2>{group.bill.billNumber ?? "บิลร่าง"} · {group.bill.title}</h2><span>Agent {group.bill.agentCode} · {group.bill.agentName} <i /> รอบ {group.bill.drawName}</span></div>
          <div className="review-bill-summary"><span>{group.items.length} หลักฐาน</span>{pendingCount > 0 && <b className="pending">รอตรวจ {pendingCount}</b>}{verifiedCount > 0 && <b className="verified">ผ่าน {verifiedCount}</b>}{rejectedCount > 0 && <b className="rejected">ตีกลับ {rejectedCount}</b>}</div>
          <nav>{pendingCount > 0 && <button type="button" disabled={busy !== null} onClick={() => verifyBill(group.bill.id, pendingCount)}>{busy === `bill:${group.bill.id}` ? "กำลังยืนยัน..." : "ยืนยันทั้งบิล"}</button>}<Link href={`/bills/${group.bill.id}`}>ดูบิล</Link><button type="button" className="secondary-button" onClick={() => loadHistory(group.bill.id)}>ประวัติทั้งบิล</button></nav>
        </header>
        <div className="review-attachment-grid">{group.items.map((item) => <article key={item.id} className={`review-attachment status-${item.status.toLowerCase()}`}>
          <button type="button" className="review-image" onClick={() => setPreview(item)}><img src={`/api/attachments/${item.id}/file`} alt={typeLabel[item.type]} /><span>เปิดดูรูปขนาดใหญ่</span></button>
          <div className="review-body">
            <header><div><small>{typeLabel[item.type]}</small><strong>{item.originalName}</strong></div><span className={`evidence-status ${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span></header>
            <dl><div><dt>ผู้แนบ</dt><dd>{item.uploadedBy}</dd></div><div><dt>เวลาที่แนบ</dt><dd>{new Date(item.createdAt).toLocaleString("th-TH")}</dd></div></dl>
            {item.payment && <section className="payment-summary"><strong>ข้อมูลการชำระเงิน</strong><div><span>{Number(item.payment.amount).toLocaleString("th-TH", { minimumFractionDigits: 2 })} บาท</span><span>{item.payment.paymentMethod}</span><span>แนบเมื่อ {new Date(item.payment.paidAt).toLocaleString("th-TH")}</span></div>{item.payment.note && <p>{item.payment.note}</p>}</section>}
            {item.rejectionReason && <p className="review-reason"><strong>เหตุผลที่ตีกลับ:</strong> {item.rejectionReason}</p>}
            <div className="review-actions"><a href={`/api/attachments/${item.id}/file?download=1`}>ดาวน์โหลด</a>{item.status === "PENDING" && <button type="button" className="danger-button" disabled={busy !== null} onClick={() => reject(item)}>ตีกลับ</button>}</div>
          </div>
        </article>)}</div>
      </section>;
    })}</div>
    {preview && <div className="evidence-modal" role="dialog" aria-modal="true" onClick={() => setPreview(null)}><div onClick={(event) => event.stopPropagation()}><header><strong>{typeLabel[preview.type]} · {preview.bill.billNumber ?? "บิลร่าง"}</strong><button type="button" onClick={() => setPreview(null)}>ปิด</button></header><img src={`/api/attachments/${preview.id}/file`} alt={preview.originalName} /><footer><span>{preview.originalName}</span><a href={`/api/attachments/${preview.id}/file?download=1`}>ดาวน์โหลด</a></footer></div></div>}
    {history && <div className="history-modal" role="dialog" aria-modal="true" onClick={() => setHistory(null)}><section onClick={(event) => event.stopPropagation()}><header><div><p className="page-eyebrow">Immutable History</p><h2>ประวัติการตรวจหลักฐาน</h2></div><button type="button" onClick={() => setHistory(null)}>ปิด</button></header>{history.rows.length === 0 ? <p>ยังไม่มีประวัติ</p> : <ol>{history.rows.map((row) => <li key={row.id}><strong>{row.action}</strong><span>{row.actor?.displayName ?? "ระบบ"} · {new Date(row.createdAt).toLocaleString("th-TH")}</span>{row.reason && <p>{row.reason}</p>}</li>)}</ol>}</section></div>}
  </>;
}

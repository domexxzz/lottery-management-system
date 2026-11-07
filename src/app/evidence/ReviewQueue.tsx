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
  duplicateCount: number;
  uploadedBy: string;
  verifiedBy: string | null;
  bill: { id: string; billNumber: string | null; title: string; status: string; totalStake: string; agentCode: string; agentName: string; drawName: string };
  payment: null | { amount: string; paidAt: string; paymentMethod: string; note: string | null; verificationStatus: string };
};

type DuplicateOccurrence = {
  id: string; type: ReviewItem["type"]; status: ReviewItem["status"]; originalName: string; createdAt: string;
  uploadedBy: { displayName: string };
  bill: { id: string; billNumber: string | null; title: string; agent: { code: string; name: string } };
};

const typeLabel = { ORDER_EVIDENCE: "หลักฐานการสั่งซื้อ", PAYMENT_EVIDENCE: "หลักฐานการชำระเงิน", OTHER: "หลักฐานอื่น" } as const;
const statusLabel = { PENDING: "รอตรวจสอบ", VERIFIED: "ตรวจสอบผ่าน", REJECTED: "ถูกตีกลับ" } as const;

export function ReviewQueue({ items, emptyTitle = "ไม่มีหลักฐานตามตัวกรองนี้", emptyDescription = "เมื่อ Agent ส่งบิลพร้อมหลักฐาน รายการจะปรากฏที่นี่" }: { items: ReviewItem[]; emptyTitle?: string; emptyDescription?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReviewItem | null>(null);
  const [history, setHistory] = useState<{ billId: string; rows: Array<{ id: string; action: string; reason: string | null; createdAt: string; actor: { displayName: string; role: string } | null }> } | null>(null);
  const [duplicateHistory, setDuplicateHistory] = useState<{ attachmentId: string; rows: DuplicateOccurrence[] } | null>(null);
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

  async function verifyBill(billId: string, pendingCount: number, totalStake: string) {
    const amount = Number(totalStake).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (!window.confirm(`ยืนยันหลักฐานที่รอตรวจทั้ง ${pendingCount} รายการของบิลยอด ${amount} บาทใช่หรือไม่`)) return;
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

  async function loadDuplicateHistory(item: ReviewItem) {
    const response = await fetch(`/api/attachments/${item.id}/duplicates`, { cache: "no-store" });
    if (!response.ok) return setError("โหลดประวัติรูปซ้ำไม่สำเร็จ");
    const body = await response.json() as { data: DuplicateOccurrence[] };
    setDuplicateHistory({ attachmentId: item.id, rows: body.data });
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
          <div><p>หลักฐานของบิลเดียวกัน</p><h2>{group.bill.billNumber ?? "บิลร่าง"} · {group.bill.title}</h2><span>Agent {group.bill.agentCode} · {group.bill.agentName} <i /> งวด {group.bill.drawName}</span></div>
          <div className="review-bill-summary"><strong className="bill-total"><small>ยอดบิล</small>{Number(group.bill.totalStake).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</strong><span>{group.items.length} หลักฐาน</span>{pendingCount > 0 && <b className="pending">รอตรวจ {pendingCount}</b>}{verifiedCount > 0 && <b className="verified">ผ่าน {verifiedCount}</b>}{rejectedCount > 0 && <b className="rejected">ตีกลับ {rejectedCount}</b>}</div>
          <nav>{pendingCount > 0 && <button type="button" disabled={busy !== null} onClick={() => verifyBill(group.bill.id, pendingCount, group.bill.totalStake)}>{busy === `bill:${group.bill.id}` ? "กำลังยืนยัน..." : "ยืนยันทั้งบิล"}</button>}<Link href={`/bills/${group.bill.id}#bill-items`}>ดูรายการบิล</Link><button type="button" className="secondary-button" onClick={() => loadHistory(group.bill.id)}>ประวัติทั้งบิล</button></nav>
        </header>
        <div className="review-attachment-grid">{group.items.map((item) => <article key={item.id} className={`review-attachment status-${item.status.toLowerCase()}`}>
          <button type="button" className="review-image" onClick={() => setPreview(item)}><img src={`/api/attachments/${item.id}/file`} alt={typeLabel[item.type]} /><span>เปิดดูรูปขนาดใหญ่</span></button>
          <div className="review-body">
            <header><div><small>{typeLabel[item.type]}</small><strong>{item.originalName}</strong></div><span className={`evidence-status ${item.status.toLowerCase()}`}>{statusLabel[item.status]}</span></header>
            <dl><div><dt>ผู้แนบ</dt><dd>{item.uploadedBy}</dd></div><div><dt>เวลาที่แนบ</dt><dd>{new Date(item.createdAt).toLocaleString("th-TH")}</dd></div></dl>
            {item.duplicateCount > 1 && <div className="duplicate-review-alert"><strong>รูปนี้เคยปรากฏ {item.duplicateCount} ครั้ง</strong><button type="button" onClick={() => loadDuplicateHistory(item)}>ดูว่าซ้ำกับรูปไหน</button></div>}
            {item.payment && <section className="payment-summary"><strong>ยอดชำระ <b>{Number(item.payment.amount).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</b></strong><div><span>{item.payment.paymentMethod}</span><span>แนบเมื่อ {new Date(item.payment.paidAt).toLocaleString("th-TH")}</span></div>{item.payment.note && <p>{item.payment.note}</p>}</section>}
            {item.rejectionReason && <p className="review-reason"><strong>เหตุผลที่ตีกลับ:</strong> {item.rejectionReason}</p>}
            <div className="review-actions"><a href={`/api/attachments/${item.id}/file?download=1`}>ดาวน์โหลด</a>{item.status === "PENDING" && <button type="button" className="danger-button" disabled={busy !== null} onClick={() => reject(item)}>ตีกลับ</button>}</div>
          </div>
        </article>)}</div>
      </section>;
    })}</div>
    {preview && <div className="evidence-modal" role="dialog" aria-modal="true" onClick={() => setPreview(null)}><div onClick={(event) => event.stopPropagation()}><header><strong>{typeLabel[preview.type]} · {preview.bill.billNumber ?? "บิลร่าง"}</strong><button type="button" onClick={() => setPreview(null)}>ปิด</button></header><img src={`/api/attachments/${preview.id}/file`} alt={preview.originalName} /><footer><span>{preview.originalName}</span><a href={`/api/attachments/${preview.id}/file?download=1`}>ดาวน์โหลด</a></footer></div></div>}
    {history && <div className="history-modal" role="dialog" aria-modal="true" onClick={() => setHistory(null)}><section onClick={(event) => event.stopPropagation()}><header><div><p className="page-eyebrow">Immutable History</p><h2>ประวัติการตรวจหลักฐาน</h2></div><button type="button" onClick={() => setHistory(null)}>ปิด</button></header>{history.rows.length === 0 ? <p>ยังไม่มีประวัติ</p> : <ol>{history.rows.map((row) => <li key={row.id}><strong>{row.action}</strong><span>{row.actor?.displayName ?? "ระบบ"} · {new Date(row.createdAt).toLocaleString("th-TH")}</span>{row.reason && <p>{row.reason}</p>}</li>)}</ol>}</section></div>}
    {duplicateHistory && <div className="duplicate-history-modal" role="dialog" aria-modal="true" onClick={() => setDuplicateHistory(null)}><section onClick={(event) => event.stopPropagation()}><header><div><p className="page-eyebrow">Duplicate Evidence History</p><h2>ประวัติรูปที่เหมือนกัน</h2><small>พบทั้งหมด {duplicateHistory.rows.length} ครั้ง · ระบบยังอนุญาตให้ส่งซ้ำได้</small></div><button type="button" onClick={() => setDuplicateHistory(null)}>ปิด</button></header><div className="duplicate-history-list">{duplicateHistory.rows.map((row) => <article key={row.id} className={row.id === duplicateHistory.attachmentId ? "is-current" : undefined}><img src={`/api/attachments/${row.id}/file`} alt={row.originalName} /><div><strong>{row.bill.billNumber ?? "บิลร่าง"} · {row.bill.title}</strong><span>{typeLabel[row.type]} · Agent {row.bill.agent.code} {row.bill.agent.name}</span><small>แนบโดย {row.uploadedBy.displayName} · {new Date(row.createdAt).toLocaleString("th-TH")}</small>{row.id === duplicateHistory.attachmentId && <b>รูปที่กำลังตรวจ</b>}</div><Link href={`/bills/${row.bill.id}#customer-evidence-heading`}>ดูบิล</Link></article>)}</div></section></div>}
  </>;
}

"use client";

/* eslint-disable @next/next/no-img-element -- private signed previews require the authenticated redirect route */

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AttachmentStatus, AttachmentType, BillStatus } from "@prisma/client";
import { AppDropdown } from "../../AppDropdown";

export type EvidenceItem = {
  id: string;
  type: AttachmentType;
  originalName: string;
  fileSize: number;
  status: AttachmentStatus;
  rejectionReason: string | null;
  createdAt: string;
  uploadedBy: string;
  verifiedBy: string | null;
  verifiedAt: string | null;
  replacesId: string | null;
  replacedById: string | null;
  duplicateCount: number;
};

type DuplicateOccurrence = {
  id: string;
  type: AttachmentType;
  status: AttachmentStatus;
  originalName: string;
  createdAt: string;
  uploadedBy: { displayName: string };
  bill: { id: string; billNumber: string | null; title: string; agent: { code: string; name: string } };
};

type Payment = {
  amount: string;
  paidAt: string;
  paymentMethod: string;
  bankName: string;
  note: string;
  verificationStatus: "PENDING" | "VERIFIED" | "REJECTED";
} | null;

const TYPE_LABEL: Record<AttachmentType, string> = {
  ORDER_EVIDENCE: "หลักฐานการสั่งซื้อ",
  PAYMENT_EVIDENCE: "หลักฐานการชำระเงิน",
  OTHER: "หลักฐานอื่น",
};

const STATUS_LABEL: Record<AttachmentStatus, string> = {
  PENDING: "รอตรวจสอบ",
  VERIFIED: "ตรวจสอบผ่าน",
  REJECTED: "ถูกตีกลับ",
};

function fileSize(value: number): string {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(2)} MB` : `${Math.ceil(value / 1024)} KB`;
}

function errorMessage(xhr: XMLHttpRequest): string {
  try {
    const body = JSON.parse(xhr.responseText) as { error?: { message?: string } };
    return body.error?.message ?? "อัปโหลดไม่สำเร็จ";
  } catch {
    return "อัปโหลดไม่สำเร็จ กรุณาลองใหม่";
  }
}

export function EvidenceManager({
  billId,
  billStatus,
  initialItems,
  billTotalStake,
  canUpload,
  maxFiles,
  maxFileSizeMb,
}: {
  billId: string;
  billStatus: BillStatus;
  initialItems: EvidenceItem[];
  initialPayment: Payment;
  billTotalStake: string;
  canUpload: boolean;
  maxFiles: number;
  maxFileSizeMb: number;
}) {
  const router = useRouter();
  const orderInput = useRef<HTMLInputElement>(null);
  const replacementInput = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState(initialItems);
  const [selectedPreview, setSelectedPreview] = useState<EvidenceItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [failedUpload, setFailedUpload] = useState<{ file: File; type: AttachmentType; replacesId?: string } | null>(null);
  const [replacement, setReplacement] = useState<EvidenceItem | null>(null);
  const [duplicateHistory, setDuplicateHistory] = useState<{ attachmentId: string; rows: DuplicateOccurrence[] } | null>(null);

  const activeItems = useMemo(() => items.filter((item) => item.replacedById === null), [items]);
  const orderItems = useMemo(() => activeItems.filter((item) => item.type === "ORDER_EVIDENCE"), [activeItems]);
  const paymentItems = useMemo(() => activeItems.filter((item) => item.type === "PAYMENT_EVIDENCE"), [activeItems]);
  const otherItems = useMemo(() => activeItems.filter((item) => item.type === "OTHER"), [activeItems]);
  const canAddNew = canUpload && (billStatus === "DRAFT" || billStatus === "CONFIRMED") && activeItems.length < maxFiles;
  const hasCorrectedPending = activeItems.some((item) => item.status === "PENDING" && item.replacesId !== null);

  function upload(file: File, type: AttachmentType, replacesId?: string) {
    if (uploading) return;
    setError(null);
    setFailedUpload(null);
    setUploading(true);
    setProgress(0);
    const form = new FormData();
    form.set("file", file);
    form.set("type", type);
    form.set("idempotencyKey", crypto.randomUUID());
    if (replacesId) form.set("replacesId", replacesId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/bills/${billId}/attachments`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      if (xhr.status < 200 || xhr.status >= 300) {
        setError(errorMessage(xhr));
        setFailedUpload({ file, type, ...(replacesId ? { replacesId } : {}) });
        return;
      }
      const response = JSON.parse(xhr.responseText) as { data: EvidenceItem };
      const created: EvidenceItem = response.data;
      setItems((current) => [
        ...current.map((item) => item.id === replacesId ? { ...item, replacedById: created.id } : item),
        created,
      ]);
      setReplacement(null);
      setProgress(100);
      router.refresh();
    };
    xhr.onerror = () => {
      setUploading(false);
      setError("เครือข่ายขัดข้องและยังไม่ได้บันทึกไฟล์ กรุณาลองใหม่");
      setFailedUpload({ file, type, ...(replacesId ? { replacesId } : {}) });
    };
    xhr.send(form);
  }

  async function remove(item: EvidenceItem) {
    if (!window.confirm(`ลบไฟล์ ${item.originalName} ใช่หรือไม่`)) return;
    setError(null);
    const response = await fetch(`/api/attachments/${item.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "ลบไฟล์ไม่สำเร็จ");
      return;
    }
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    router.refresh();
  }

  async function resubmit() {
    if (!window.confirm("ส่งหลักฐานที่แก้ไขแล้วเข้าคิวตรวจอีกครั้งใช่หรือไม่")) return;
    const response = await fetch(`/api/bills/${billId}/evidence/resubmit`, { method: "POST" });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "ส่งตรวจใหม่ไม่สำเร็จ");
      return;
    }
    router.refresh();
  }

  async function showDuplicateHistory(item: EvidenceItem) {
    setError(null);
    const response = await fetch(`/api/attachments/${item.id}/duplicates`, { cache: "no-store" });
    if (!response.ok) {
      setError("โหลดประวัติรูปซ้ำไม่สำเร็จ");
      return;
    }
    const body = await response.json() as { data: DuplicateOccurrence[] };
    setDuplicateHistory({ attachmentId: item.id, rows: body.data });
  }

  function drop(event: React.DragEvent<HTMLDivElement>, type: AttachmentType) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) upload(file, type);
  }

  function evidenceCards(entries: EvidenceItem[]) {
    return entries.map((item) => (
      <article key={item.id} className={`evidence-card status-${item.status.toLowerCase()}`}>
        <button type="button" className="evidence-thumbnail" onClick={() => setSelectedPreview(item)} aria-label={`เปิดดู ${item.originalName}`}>
          <img src={`/api/attachments/${item.id}/file`} alt={TYPE_LABEL[item.type]} />
        </button>
        <div className="evidence-card-body">
          <div><strong>{TYPE_LABEL[item.type]}</strong><span className={`evidence-status ${item.status.toLowerCase()}`}>{STATUS_LABEL[item.status]}</span></div>
          <p>{item.originalName} · {fileSize(item.fileSize)}</p>
          <small>แนบโดย {item.uploadedBy} · {new Date(item.createdAt).toLocaleString("th-TH")}</small>
          {item.verifiedBy && <small>ตรวจโดย {item.verifiedBy}{item.verifiedAt ? ` · ${new Date(item.verifiedAt).toLocaleString("th-TH")}` : ""}</small>}
          {item.duplicateCount > 1 && <div className="duplicate-evidence-alert"><strong>รูปนี้เคยปรากฏ {item.duplicateCount} ครั้ง</strong><button type="button" onClick={() => showDuplicateHistory(item)}>ดูประวัติรูปซ้ำ</button></div>}
          {item.rejectionReason && <div className="rejection-reason"><strong>เหตุผลที่ตีกลับ</strong><span>{item.rejectionReason}</span></div>}
          <div className="evidence-actions">
            <button type="button" className="secondary-button" onClick={() => setSelectedPreview(item)}>ดูรูป</button>
            <a href={`/api/attachments/${item.id}/file?download=1`}>ดาวน์โหลด</a>
            {canUpload && billStatus === "DRAFT" && <button type="button" className="danger-button" onClick={() => remove(item)}>ลบ</button>}
            {canUpload && item.status === "REJECTED" && billStatus !== "SETTLED" && billStatus !== "CANCELLED" && <button type="button" onClick={() => { setReplacement(item); replacementInput.current?.click(); }}>เปลี่ยนไฟล์</button>}
          </div>
        </div>
      </article>
    ));
  }

  return (
    <section id="bill-evidence" className="evidence-section" aria-labelledby="customer-evidence-heading">
      <div className="evidence-heading">
        <div><p className="page-eyebrow">Customer Evidence</p><h2 id="customer-evidence-heading">หลักฐานจากลูกค้า</h2><p>ไฟล์ทั้งหมดเก็บแบบ Private และเปิดดูได้เฉพาะผู้มีสิทธิ์</p></div>
        <span className="evidence-count">{activeItems.length}/{maxFiles} รูป</span>
      </div>

      <div className="evidence-security-note">ระบบตรวจชนิดไฟล์จริง ลบ EXIF/GPS และแปลงเป็น WEBP ก่อนจัดเก็บ · ยังไม่ได้เปิด Malware Scanner ใน Development</div>

      <div className="evidence-upload-grid">
        <div
          className={`evidence-dropzone ${canAddNew ? "" : "is-disabled"}`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => canAddNew && drop(event, "ORDER_EVIDENCE")}
        >
          <strong>หลักฐานการสั่งซื้อ</strong>
          <p>จำเป็นอย่างน้อย 1 รูปก่อนยืนยันบิล</p>
          <input ref={orderInput} className="evidence-file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; if (file) upload(file, "ORDER_EVIDENCE"); event.target.value = ""; }} />
          <button type="button" disabled={!canAddNew || uploading} onClick={() => orderInput.current?.click()}>ถ่ายรูปหรือเลือกไฟล์</button>
          <small>ลากไฟล์มาวางได้ · JPG, PNG, WEBP · ไม่เกิน {maxFileSizeMb} MB</small>
          <div className="evidence-inline-list">
            {orderItems.length > 0 ? evidenceCards(orderItems) : <div className="evidence-slot-empty">ยังไม่ได้แนบรูปการสั่งซื้อ</div>}
          </div>
        </div>

        {/*
          * เลิกรับสลิปการชำระเงินแล้ว จึงไม่มีช่องอัปโหลด
          * แต่บิลเก่าที่เคยแนบไว้ต้องยังเห็นของเดิมได้ ไม่งั้นหลักฐานของบิล
          * ที่ปิดไปแล้วจะหายไปจากหน้าจอทั้งที่ยังอยู่ในฐานข้อมูล
          */}
        {paymentItems.length > 0 && (
          <div className="evidence-dropzone payment-zone is-disabled">
            <strong>หลักฐานการชำระเงิน (เก็บไว้ดูย้อนหลัง)</strong>
            <p>ระบบไม่รับสลิปเพิ่มแล้ว รายการด้านล่างคือของที่เคยแนบไว้</p>
            <div className="evidence-inline-list">{evidenceCards(paymentItems)}</div>
          </div>
        )}
      </div>

      {uploading && <div className="upload-progress" role="status"><span style={{ width: `${progress}%` }} /><strong>กำลังอัปโหลด {progress}%</strong></div>}
      {error && <div className="evidence-error" role="alert"><span>{error}</span>{failedUpload && <button type="button" onClick={() => upload(failedUpload.file, failedUpload.type, failedUpload.replacesId)}>ลองใหม่</button>}</div>}

      {otherItems.length > 0 && <div className="evidence-list">{evidenceCards(otherItems)}</div>}

      <input ref={replacementInput} className="evidence-file-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden tabIndex={-1} onChange={(event) => { const file = event.target.files?.[0]; if (file && replacement) upload(file, replacement.type, replacement.id); event.target.value = ""; }} />
      {hasCorrectedPending && <button type="button" className="resubmit-button" onClick={resubmit}>ส่งหลักฐานที่แก้ไขแล้วเข้าตรวจใหม่</button>}

      {selectedPreview && <div className="evidence-modal" role="dialog" aria-modal="true" aria-label="ตัวอย่างหลักฐาน" onClick={() => setSelectedPreview(null)}><div onClick={(event) => event.stopPropagation()}><header><strong>{TYPE_LABEL[selectedPreview.type]}</strong><button type="button" onClick={() => setSelectedPreview(null)} aria-label="ปิด">ปิด</button></header><img src={`/api/attachments/${selectedPreview.id}/file`} alt={selectedPreview.originalName} /><footer><span>{selectedPreview.originalName}</span><a href={`/api/attachments/${selectedPreview.id}/file?download=1`}>ดาวน์โหลดต้นฉบับที่จัดเก็บ</a></footer></div></div>}
      {duplicateHistory && <div className="duplicate-history-modal" role="dialog" aria-modal="true" onClick={() => setDuplicateHistory(null)}><section onClick={(event) => event.stopPropagation()}><header><div><p className="page-eyebrow">Duplicate Evidence History</p><h2>ประวัติรูปที่เหมือนกัน</h2><small>พบทั้งหมด {duplicateHistory.rows.length} ครั้ง</small></div><button type="button" onClick={() => setDuplicateHistory(null)}>ปิด</button></header><div className="duplicate-history-list">{duplicateHistory.rows.map((row) => <article key={row.id} className={row.id === duplicateHistory.attachmentId ? "is-current" : undefined}><img src={`/api/attachments/${row.id}/file`} alt={row.originalName} /><div><strong>{row.bill.billNumber ?? "บิลร่าง"} · {row.bill.title}</strong><span>{TYPE_LABEL[row.type]} · Agent {row.bill.agent.code} {row.bill.agent.name}</span><small>แนบโดย {row.uploadedBy.displayName} · {new Date(row.createdAt).toLocaleString("th-TH")}</small>{row.id === duplicateHistory.attachmentId && <b>รูปปัจจุบัน</b>}</div><a href={`/bills/${row.bill.id}#customer-evidence-heading`}>ดูบิล</a></article>)}</div></section></div>}
    </section>
  );
}

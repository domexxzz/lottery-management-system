import Link from "next/link";
import type { AttachmentStatus, AttachmentType } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";
import { listEvidenceReviewQueue } from "@/lib/evidence/service";
import { EvidenceFilters } from "./EvidenceFilters";
import { ReviewQueue } from "./ReviewQueue";

type SearchValues = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
function dateStart(value: string | undefined): Date | undefined { if (!value) return undefined; const date = new Date(`${value}T00:00:00+07:00`); return Number.isNaN(date.getTime()) ? undefined : date; }
function dateEnd(value: string | undefined): Date | undefined { if (!value) return undefined; const date = new Date(`${value}T23:59:59.999+07:00`); return Number.isNaN(date.getTime()) ? undefined : date; }

export async function EvidenceReviewScreen({ actor, params, mode }: { actor: Actor; params: SearchValues; mode: "queue" | "verified" }) {
  const statusRaw = first(params.status);
  const queueStatus = statusRaw && ["PENDING", "REJECTED"].includes(statusRaw) ? statusRaw as AttachmentStatus : undefined;
  const typeRaw = first(params.type);
  const page = Math.max(1, Number(first(params.page)) || 1);
  const basePath = mode === "verified" ? "/evidence/verified" : "/evidence";
  const result = await listEvidenceReviewQueue(actor, {
    query: first(params.q)?.trim() || undefined,
    status: mode === "verified" ? "VERIFIED" : queueStatus,
    statuses: mode === "queue" && !queueStatus ? ["PENDING", "REJECTED"] : undefined,
    type: typeRaw && ["ORDER_EVIDENCE", "PAYMENT_EVIDENCE", "OTHER"].includes(typeRaw) ? typeRaw as AttachmentType : undefined,
    dateFrom: dateStart(first(params.from)),
    dateTo: dateEnd(first(params.to)),
    page,
    pageSize: 24,
  });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const serialized = result.items.map((item) => ({
    id: item.id, type: item.type, originalName: item.originalName, fileSize: item.fileSize, status: item.status,
    rejectionReason: item.rejectionReason, createdAt: item.createdAt.toISOString(), verifiedAt: item.verifiedAt?.toISOString() ?? null,
    uploadedBy: item.uploadedBy.displayName, verifiedBy: item.verifiedBy?.displayName ?? null,
    bill: { id: item.bill.id, billNumber: item.bill.billNumber, title: item.bill.title, status: item.bill.status, agentCode: item.bill.agent.code, agentName: item.bill.agent.name, drawName: item.bill.draw.name },
    payment: item.payment ? { amount: item.payment.amount.toFixed(2), paidAt: item.payment.paidAt.toISOString(), paymentMethod: item.payment.paymentMethod, note: item.payment.note, verificationStatus: item.payment.verificationStatus } : null,
  }));
  const buildPageLink = (target: number) => { const next = new URLSearchParams(); for (const [key, raw] of Object.entries(params)) { const value = first(raw); if (value && key !== "page" && !(mode === "verified" && key === "status")) next.set(key, value); } next.set("page", String(target)); return `${basePath}?${next}`; };
  const verified = mode === "verified";

  return <main className="workspace-page evidence-review-page"><section className="card workspace-card">
    <p><Link href="/">← หน้าภาพรวม</Link></p>
    <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">{verified ? "Verified Evidence" : "Evidence Review"}</p><h1>{verified ? "หลักฐานที่ตรวจแล้ว" : "ตรวจหลักฐานจากลูกค้า"}</h1><p>{verified ? "เก็บหลักฐานที่ตรวจสอบผ่านแล้วสำหรับเปิดดูและตรวจสอบย้อนหลัง" : "แสดงเฉพาะหลักฐานที่รอตรวจสอบหรือถูกตีกลับ เพื่อให้คิวงานชัดเจน"}</p></div><span className="review-total">{result.total} บิล</span></header>
    <nav className="evidence-view-switcher" aria-label="มุมมองหลักฐาน"><Link className={!verified ? "active" : undefined} href="/evidence">รอตรวจ / ตีกลับ</Link><Link className={verified ? "active" : undefined} href="/evidence/verified">ตรวจแล้ว</Link></nav>
    <EvidenceFilters mode={mode}/>
    <ReviewQueue items={serialized} emptyTitle={verified ? "ยังไม่มีหลักฐานที่ตรวจแล้ว" : "ไม่มีหลักฐานที่รอตรวจหรือตีกลับ"} emptyDescription={verified ? "หลักฐานที่ Admin ตรวจผ่านจะถูกเก็บและแสดงในหน้านี้" : "คิวตรวจว่างแล้ว หลักฐานที่ตรวจผ่านสามารถดูได้ในหน้าหลักฐานที่ตรวจแล้ว"}/>
    {pages > 1 && <nav className="review-pagination" aria-label="หน้ารายการ"><Link aria-disabled={page <= 1} href={page <= 1 ? buildPageLink(1) : buildPageLink(page - 1)}>ก่อนหน้า</Link><span>หน้า {page} จาก {pages}</span><Link aria-disabled={page >= pages} href={page >= pages ? buildPageLink(pages) : buildPageLink(page + 1)}>ถัดไป</Link></nav>}
  </section></main>;
}

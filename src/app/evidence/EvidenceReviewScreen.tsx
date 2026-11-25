import Link from "next/link";
import type { Actor } from "@/lib/auth/context";
import { orgScope } from "@/lib/auth/context";
import { auditDateRange } from "@/lib/audit/history";
import { can } from "@/lib/auth/permissions";
import { dashboardDrawLabel, resolveDashboardDrawScope } from "@/lib/dashboard/lottery-draw-filter";
import { prisma } from "@/lib/db";
import { listEvidenceReviewQueue } from "@/lib/evidence/service";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";
import { drawDateLabel } from "@/lib/bills/betting";
import { daysUntilExpiry, evidenceExpiresAt, evidenceSummaryByDraw, purgeExpiredEvidenceSoon, remainingLabel } from "@/lib/evidence/retention";
import { DeleteAllEvidence } from "./DeleteAllEvidence";
import { DashboardFilters } from "../DashboardFilters";
import { ReviewQueue } from "./ReviewQueue";

type SearchValues = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }

export async function EvidenceReviewScreen({ actor, params, mode }: { actor: Actor; params: SearchValues; mode: "queue" | "verified" }) {
  const page = Math.max(1, Number(first(params.page)) || 1);
  const basePath = mode === "verified" ? "/evidence/verified" : "/evidence";
  const dates = auditDateRange(first(params.dateFrom), first(params.dateTo));
  const physicalDraws = await prisma.draw.findMany({
    where: orgScope(actor),
    orderBy: { cutoffAt: "desc" },
    select: { id: true, name: true, drawDate: true, cutoffAt: true, status: true, lotteryType: true, laoFamilyId: true },
  });
  const drawScope = resolveDashboardDrawScope(physicalDraws, first(params.lottery), first(params.drawId));
  // ลบรูปที่ครบ 1 ปีก่อนแสดงรายการ (อย่างมากชั่วโมงละครั้ง ไม่ทำให้หน้าช้า)
  await purgeExpiredEvidenceSoon();
  const canDelete = can(actor.role, "evidence.delete");
  const now = new Date();
  const summary = canDelete ? await evidenceSummaryByDraw(actor) : null;
  const result = await listEvidenceReviewQueue(actor, {
    status: mode === "verified" ? "VERIFIED" : undefined,
    statuses: mode === "queue" ? ["PENDING", "REJECTED"] : undefined,
    drawIds: drawScope.drawIds,
    dateFrom: dates.from,
    dateTo: dates.to,
    page,
    pageSize: 24,
  });
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const serialized = result.items.map((item) => ({
    id: item.id, type: item.type, originalName: item.originalName, fileSize: item.fileSize, status: item.status,
    rejectionReason: item.rejectionReason, createdAt: item.createdAt.toISOString(), verifiedAt: item.verifiedAt?.toISOString() ?? null,
    duplicateCount: item.duplicateCount,
    expiresAt: evidenceExpiresAt(item.createdAt).toISOString(),
    daysLeft: daysUntilExpiry(item.createdAt, now),
    remaining: remainingLabel(daysUntilExpiry(item.createdAt, now)),
    uploadedBy: item.uploadedBy.displayName, verifiedBy: item.verifiedBy?.displayName ?? null,
    bill: { id: item.bill.id, drawSequence: item.bill.drawSequence, title: item.bill.title, status: item.bill.status, totalStake: item.bill.totalStake.toFixed(2), agentCode: item.bill.agent.code, agentName: item.bill.agent.name, drawName: item.bill.draw.name },
    payment: item.payment ? { amount: item.payment.amount.toFixed(2), paidAt: item.payment.paidAt.toISOString(), paymentMethod: item.payment.paymentMethod, note: item.payment.note, verificationStatus: item.payment.verificationStatus } : null,
  }));
  const buildPageLink = (target: number) => { const next = new URLSearchParams(); for (const [key, raw] of Object.entries(params)) { const value = first(raw); if (value && key !== "page" && !(mode === "verified" && key === "status")) next.set(key, value); } next.set("page", String(target)); return `${basePath}?${next}`; };
  const verified = mode === "verified";
  const switchParams = new URLSearchParams();
  if (drawScope.category !== "ALL") switchParams.set("lottery", drawScope.category);
  if (drawScope.selectedDraw) switchParams.set("drawId", drawScope.selectedDraw.id);
  if (dates.fromDay) switchParams.set("dateFrom", dates.fromDay);
  if (dates.toDay) switchParams.set("dateTo", dates.toDay);
  const queueHref = `/evidence${switchParams.size ? `?${switchParams}` : ""}`;
  const verifiedHref = `/evidence/verified${switchParams.size ? `?${switchParams}` : ""}`;

  return <main className="workspace-page evidence-review-page"><section className="card workspace-card">
    <p><Link href="/">← หน้าภาพรวม</Link></p>
    <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">{verified ? "Verified Evidence" : "Evidence Review"}</p><h1>{verified ? "หลักฐานที่ตรวจแล้ว" : "ตรวจหลักฐานจากลูกค้า"}</h1><p>{verified ? "เก็บหลักฐานที่ตรวจสอบผ่านแล้วสำหรับเปิดดูและตรวจสอบย้อนหลัง" : "แสดงเฉพาะหลักฐานที่รอตรวจสอบหรือถูกตีกลับ เพื่อให้คิวงานชัดเจน"}</p></div><span className="review-total">{result.total} บิล</span></header>
    <nav className="evidence-view-switcher" aria-label="มุมมองหลักฐาน"><Link className={!verified ? "active" : undefined} href={queueHref}>รอตรวจ / ตีกลับ</Link><Link className={verified ? "active" : undefined} href={verifiedHref}>ตรวจแล้ว</Link></nav>
    <div className="evidence-retention-bar">
      <p><strong>เก็บรูปหลักฐานไว้ 1 ปี</strong> นับจากวันที่แนบ ครบแล้วระบบลบให้อัตโนมัติ ดูเวลาที่เหลือได้ที่แต่ละรูป</p>
      {summary && <DeleteAllEvidence total={summary.total} draws={summary.draws.map((draw) => ({ drawId: draw.drawId, label: `งวด ${drawDateLabel({ drawDate: draw.drawDate, name: draw.drawName })}`, count: draw.count }))} />}
    </div>
    <DashboardFilters
      draws={drawScope.logicalDraws.map((draw) => ({ id: draw.id, label: `${reportCategoryLabel(draw.category)} · ${dashboardDrawLabel(draw)}`, lotteryType: draw.lotteryType, category: draw.category, status: draw.status }))}
      category={drawScope.category}
      selectedDrawId={drawScope.selectedDraw?.id}
    />
    <ReviewQueue items={serialized} canDelete={canDelete} emptyTitle={verified ? "ยังไม่มีหลักฐานที่ตรวจแล้ว" : "ไม่มีหลักฐานที่รอตรวจหรือตีกลับ"} emptyDescription={verified ? "หลักฐานที่ Admin ตรวจผ่านจะถูกเก็บและแสดงในหน้านี้" : "คิวตรวจว่างแล้ว หลักฐานที่ตรวจผ่านสามารถดูได้ในหน้าหลักฐานที่ตรวจแล้ว"}/>
    {pages > 1 && <nav className="review-pagination" aria-label="หน้ารายการ"><Link aria-disabled={page <= 1} href={page <= 1 ? buildPageLink(1) : buildPageLink(page - 1)}>ก่อนหน้า</Link><span>หน้า {page} จาก {pages}</span><Link aria-disabled={page >= pages} href={page >= pages ? buildPageLink(pages) : buildPageLink(page + 1)}>ถัดไป</Link></nav>}
  </section></main>;
}

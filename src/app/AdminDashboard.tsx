import Link from "next/link";
import { DashboardHeading } from "./DashboardHeading";
import type { BillStatus, Prisma } from "@prisma/client";
import type { Actor } from "@/lib/auth/context";
import { orgScope } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { DashboardIcon as Icon } from "./DashboardIcon";
import { DashboardFilters } from "./DashboardFilters";
import { AdminOperationsChart } from "./AdminOperationsChart";
import "./admin-dashboard.css";

type DashboardFilter = { drawId?: string; agentId?: string; status?: string; dateFrom?: string; dateTo?: string };
const BILL_STATUSES: BillStatus[] = ["DRAFT", "CONFIRMED", "LOCKED", "SETTLED", "CANCELLED"];
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const ACTION_LABEL: Record<string, string> = {
  FILE_UPLOADED: "แนบหลักฐาน", FILE_VERIFIED: "ยืนยันหลักฐาน", FILE_REJECTED: "ตีกลับหลักฐาน",
  PAYMENT_VERIFIED: "ยืนยันการชำระเงิน", PAYMENT_REJECTED: "ตีกลับการชำระเงิน",
  CONFIRM: "ยืนยันบิล", CANCEL: "ยกเลิกบิล", APPROVE: "อนุมัติ", REJECT: "ตีกลับ", LOCK: "ปิดรับงวด",
};
const DRAW_STEPS = ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED", "CLOSED"] as const;
const STEP_LABEL: Record<string, string> = { OPEN: "เปิดรับ", LOCKED: "ปิดรับ", RESULT_PENDING: "กรอกผล", SETTLED: "ตรวจสอบยอด", CLOSED: "เสร็จสิ้น" };

export async function AdminDashboard({ actor, filters }: { actor: Actor; filters: DashboardFilter }) {
  const scope = orgScope(actor);
  const parsedFrom = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00+07:00`) : undefined;
  const parsedTo = filters.dateTo ? new Date(`${filters.dateTo}T23:59:59.999+07:00`) : undefined;
  const dateFilter = parsedFrom || parsedTo ? { createdAt: { ...(parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? { gte: parsedFrom } : {}), ...(parsedTo && !Number.isNaN(parsedTo.getTime()) ? { lte: parsedTo } : {}) } } : {};
  const selectedStatus = BILL_STATUSES.includes(filters.status as BillStatus) ? filters.status as BillStatus : undefined;
  const billWhere: Prisma.BillWhereInput = {
    ...scope,
    ...(filters.drawId ? { drawId: filters.drawId } : {}),
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(selectedStatus ? { status: selectedStatus } : {}),
    ...dateFilter,
  };
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const todayStart = new Date(`${todayKey}T00:00:00+07:00`);
  const trendStart = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000);

  const [draws, currentDraw, pendingEvidence, pendingEvidenceCount, awaitingResultDraws, reviewedToday, rejectedToday, pendingSettlements, pendingCancellations, missingEvidence, rejectedOutstanding, recentAudit, todayBills, trendBills, trendReviews] = await Promise.all([
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, cutoffAt: true } }),
    filters.drawId
      ? prisma.draw.findFirst({ where: { ...scope, id: filters.drawId }, select: { id: true, name: true, status: true, cutoffAt: true } })
      : prisma.draw.findFirst({ where: { ...scope, status: { in: ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED"] } }, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, cutoffAt: true } }),
    prisma.billAttachment.findMany({
      where: { ...scope, status: "PENDING", replacedBy: null, bill: billWhere },
      orderBy: { createdAt: "asc" }, take: 30,
      select: { id: true, type: true, createdAt: true, bill: { select: { id: true, billNumber: true, title: true, agent: { select: { code: true, name: true } }, draw: { select: { name: true } } } } },
    }),
    prisma.billAttachment.count({ where: { ...scope, status: "PENDING", replacedBy: null, bill: billWhere } }),
    prisma.draw.count({ where: { ...scope, status: { in: ["LOCKED", "RESULT_PENDING"] } } }),
    prisma.billAttachment.count({ where: { ...scope, status: "VERIFIED", verifiedAt: { gte: todayStart }, verifiedById: actor.userId } }),
    prisma.billAttachment.count({ where: { ...scope, status: "REJECTED", verifiedAt: { gte: todayStart }, verifiedById: actor.userId } }),
    prisma.settlement.count({ where: { ...scope, status: "DRAFT", ...(filters.drawId ? { drawId: filters.drawId } : {}) } }),
    prisma.bill.count({ where: { ...billWhere, cancelRequestedAt: { not: null }, cancelledAt: null } }),
    prisma.bill.count({ where: { ...billWhere, status: { in: ["CONFIRMED", "LOCKED"] }, attachments: { none: { type: "ORDER_EVIDENCE", replacedBy: null, status: { not: "REJECTED" } } } } }),
    prisma.billAttachment.count({ where: { ...scope, status: "REJECTED", replacedBy: null, bill: billWhere } }),
    prisma.auditEvent.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 8, select: { id: true, action: true, entityType: true, reason: true, createdAt: true, actor: { select: { displayName: true } } } }),
    prisma.bill.count({ where: { ...billWhere, createdAt: { gte: todayStart } } }),
    prisma.bill.findMany({ where: { ...billWhere, createdAt: { gte: trendStart } }, select: { createdAt: true, totalStake: true } }),
    prisma.billAttachment.findMany({ where: { ...scope, verifiedById: actor.userId, verifiedAt: { gte: trendStart } }, select: { verifiedAt: true } }),
  ]);

  const evidenceByBill = new Map<string, { bill: (typeof pendingEvidence)[number]["bill"]; count: number; oldest: Date }>();
  for (const item of pendingEvidence) {
    const row = evidenceByBill.get(item.bill.id);
    if (row) row.count += 1;
    else evidenceByBill.set(item.bill.id, { bill: item.bill, count: 1, oldest: item.createdAt });
  }
  const queue = [...evidenceByBill.values()].slice(0, 6);
  const overdue = pendingEvidence.filter((item) => Date.now() - item.createdAt.getTime() >= 60 * 60 * 1000).length;
  const dayFormat = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok" });
  const daily = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(trendStart.getTime() + index * 24 * 60 * 60 * 1000);
    const label = dayFormat.format(date);
    return { label, bills: 0, sales: 0, reviewed: 0 };
  });
  const dailyByLabel = new Map(daily.map((row) => [row.label, row]));
  for (const bill of trendBills) { const row = dailyByLabel.get(dayFormat.format(bill.createdAt)); if (row) { row.bills += 1; row.sales += Number(bill.totalStake); } }
  for (const review of trendReviews) { if (!review.verifiedAt) continue; const row = dailyByLabel.get(dayFormat.format(review.verifiedAt)); if (row) row.reviewed += 1; }
  const stepIndex = currentDraw ? DRAW_STEPS.indexOf(currentDraw.status as (typeof DRAW_STEPS)[number]) : -1;
  const drawAction = !currentDraw ? { label: "ดูรายการงวด", href: "/draws" }
    : currentDraw.status === "OPEN" ? { label: "จัดการงวด", href: `/draws/${currentDraw.id}` }
      : currentDraw.status === "LOCKED" || currentDraw.status === "RESULT_PENDING" ? { label: "กรอกผลรางวัล", href: `/draws/${currentDraw.id}` }
        : { label: "ตรวจสอบยอด", href: `/draws/${currentDraw.id}` };
  const tasks = [
    { label: "หลักฐานรอตรวจ", detail: overdue ? `${overdue} หลักฐานรอเกิน 60 นาที` : "หลักฐานจากลูกค้าที่ยังไม่ได้ตรวจ", count: pendingEvidenceCount, href: "/evidence", icon: "evidence" as const },
    { label: "งวดรอลงผล", detail: "ปิดรับแล้วและรอกรอกหรือตรวจผลรางวัล", count: awaitingResultDraws, href: "/draws", icon: "draw" as const },
    { label: "ยอดรอตรวจ", detail: "รายการคำนวณที่ยังไม่ได้ตรวจสอบยอด", count: pendingSettlements, href: currentDraw ? `/draws/${currentDraw.id}` : "/draws", icon: "report" as const },
  ];

  return <main className="dashboard-body admin-ops-dashboard">
    <div className="welcome-row admin-welcome">
      <DashboardHeading icon="audit" eyebrow="งานผู้ดูแลระบบ" title="ศูนย์งานปฏิบัติการ">
        ดูงานค้าง ตรวจหลักฐาน กรอกผล และตรวจสอบยอดจากหน้าเดียว
      </DashboardHeading>
      <div className="admin-primary-actions"><Link href="/evidence"><Icon name="evidence"/><span><small>งานเร่งด่วน</small><strong>ตรวจหลักฐาน</strong></span><Icon name="arrow"/></Link><Link href={drawAction.href} className="secondary"><Icon name="draw"/><span><small>ขั้นตอนถัดไป</small><strong>{drawAction.label}</strong></span><Icon name="arrow"/></Link></div>
    </div>

    <DashboardFilters draws={draws.map((draw) => ({ id: draw.id, label: draw.name }))} />

    <section className="admin-kpi-grid" aria-label="สรุปงานวันนี้">
      <article><span><Icon name="bill"/></span><div><small>บิลใหม่วันนี้</small><strong>{todayBills}</strong><p>ตามตัวกรองที่เลือก</p></div></article>
      <article className={pendingEvidence.length ? "warning" : "success"}><span><Icon name="evidence"/></span><div><small>หลักฐานรอตรวจ</small><strong>{pendingEvidence.length}</strong><p>{overdue ? `${overdue} รายการรอเกิน 60 นาที` : "ไม่มีงานเกินเวลา"}</p></div></article>
      <article className="success"><span><Icon name="audit"/></span><div><small>ตรวจผ่านวันนี้</small><strong>{reviewedToday}</strong><p>โดยบัญชีของคุณ</p></div></article>
      <article className={rejectedToday ? "danger" : "success"}><span><Icon name="alert"/></span><div><small>ตีกลับวันนี้</small><strong>{rejectedToday}</strong><p>โดยบัญชีของคุณ</p></div></article>
    </section>

    <AdminOperationsChart daily={daily} backlog={{ evidence: pendingEvidence.length, settlement: pendingSettlements, cancellation: pendingCancellations, rejected: rejectedOutstanding }} />

    <section className="admin-main-grid">
      <article className="dashboard-panel admin-queue"><div className="panel-heading"><div><p className="eyebrow">Priority Queue</p><h2>คิวหลักฐานที่ต้องตรวจ</h2></div><Link href="/evidence">ดูทั้งหมด <Icon name="arrow"/></Link></div>{queue.length === 0 ? <p className="empty-state">ไม่มีหลักฐานรอตรวจตามตัวกรอง</p> : <div>{queue.map((row) => { const minutes = Math.max(0, Math.round((Date.now() - row.oldest.getTime()) / 60000)); return <Link key={row.bill.id} href="/evidence"><span className={minutes >= 60 ? "priority-high" : "priority-normal"}>{minutes >= 60 ? "เร่งด่วน" : "รอตรวจ"}</span><div><strong>{row.bill.billNumber ?? "บิลร่าง"} · {row.bill.title}</strong><small>{row.bill.agent.code} {row.bill.agent.name} · {row.bill.draw.name}</small></div><b>{row.count} รูป</b><time>{minutes} นาที</time><Icon name="arrow"/></Link>; })}</div>}</article>

      <article className="dashboard-panel admin-round-panel"><div className="panel-heading"><div><p className="eyebrow">Current Workflow</p><h2>สถานะงวด</h2></div></div>{!currentDraw ? <p className="empty-state">ยังไม่มีงวดที่กำลังดำเนินการ</p> : <><div className="draw-meta"><strong>{currentDraw.name}</strong><span>ปิดรับ {DATE_TIME.format(currentDraw.cutoffAt)}</span></div><ol className="draw-timeline">{DRAW_STEPS.map((step, index) => <li key={step} className={index < stepIndex ? "complete" : index === stepIndex ? "current" : ""}><span>{index < stepIndex ? "✓" : index + 1}</span><div><strong>{STEP_LABEL[step]}</strong><small>{index === stepIndex ? "กำลังดำเนินการ" : index < stepIndex ? "เสร็จแล้ว" : "รอดำเนินการ"}</small></div></li>)}</ol><Link className="admin-next-action" href={drawAction.href}>{drawAction.label} <Icon name="arrow"/></Link></>}</article>
    </section>

    <section className="admin-secondary-grid">
      <article className="dashboard-panel"><div className="panel-heading"><div><p className="eyebrow">Today&apos;s Priorities</p><h2>งานที่ต้องทำวันนี้</h2></div></div><div className="admin-task-list">{tasks.map((task) => <Link key={task.label} href={task.href}><span className={task.count ? "has-work" : "clear"}><Icon name={task.icon}/></span><div><strong>{task.label}</strong><small>{task.count ? task.detail : "ไม่มีรายการค้าง"}</small></div><b>{task.count}</b><Icon name="arrow"/></Link>)}</div></article>
      <article className="dashboard-panel"><div className="panel-heading"><div><p className="eyebrow">Exceptions</p><h2>รายการที่ต้องระวัง</h2></div></div><div className="admin-alert-list"><Link href="/evidence"><span>!</span><div><strong>หลักฐานถูกตีกลับยังไม่แก้</strong><small>รอ Agent แนบไฟล์ใหม่</small></div><b>{rejectedOutstanding}</b></Link><Link href="/bills"><span>!</span><div><strong>บิลที่ไม่มีหลักฐานการสั่งซื้อ</strong><small>บิลยืนยันหรือปิดรับแล้ว</small></div><b>{missingEvidence}</b></Link><Link href={currentDraw ? `/draws/${currentDraw.id}` : "/draws"}><span>!</span><div><strong>รายการรอตรวจสอบยอด</strong><small>ต้องดำเนินการก่อนปิดบัญชี</small></div><b>{pendingSettlements}</b></Link></div></article>
    </section>

    <section className="dashboard-panel admin-activity"><div className="panel-heading"><div><p className="eyebrow">Audit Trail</p><h2>กิจกรรมล่าสุด</h2></div><Link href="/audit">ดูประวัติทั้งหมด <Icon name="arrow"/></Link></div>{recentAudit.length === 0 ? <p className="empty-state">ยังไม่มีกิจกรรม</p> : <div>{recentAudit.map((event) => <article key={event.id}><span className={event.action.includes("REJECT") || event.action === "CANCEL" ? "danger" : "normal"}><Icon name={event.action.includes("REJECT") || event.action === "CANCEL" ? "alert" : "audit"}/></span><div><strong>{ACTION_LABEL[event.action] ?? event.action}</strong><small>{event.entityType}{event.reason ? ` · ${event.reason}` : ""}</small></div><b>{event.actor?.displayName ?? "ระบบ"}</b><time>{DATE_TIME.format(event.createdAt)}</time></article>)}</div>}</section>
  </main>;
}

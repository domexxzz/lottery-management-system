import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma, ResultStatus } from "@prisma/client";
import { getActor, orgScope } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { statusLabel } from "@/lib/bills/lifecycle";
import { AuditFilters } from "./AuditFilters";
import { DashboardIcon } from "../DashboardIcon";
import "./audit.css";

const PAGE_SIZE = 25;
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });
const RESULT_LABEL: Record<ResultStatus, string> = { DRAFT: "รอตรวจ", APPROVED: "ตรวจแล้ว", REJECTED: "ตีกลับ" };

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positivePage(value: string | undefined) {
  const parsed = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

export const dynamic = "force-dynamic";

export default async function InspectionHistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "audit.viewAll") || actor.role === "AGENT") redirect("/");

  const query = await searchParams;
  const q = first(query.q)?.trim();
  const drawId = first(query.draw);
  const enteredBy = first(query.enteredBy);
  const check = first(query.check);
  const view = first(query.view) === "bills" ? "bills" : "results";
  const requestedPage = positivePage(first(query.page));
  const scope = orgScope(actor);

  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    const value = first(rawValue);
    if (value) params.set(key, value);
  }
  function href(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    return `/audit${next.size ? `?${next}` : ""}`;
  }

  const billWhere: Prisma.BillWhereInput = {
    ...scope,
    ...(drawId ? { drawId } : {}),
    ...(enteredBy ? { createdById: enteredBy } : {}),
    ...(check === "PENDING" ? { status: "DRAFT" } : check === "PASSED" ? { status: { not: "DRAFT" } } : {}),
    ...(q ? {
      OR: [
        { billNumber: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { items: { some: { number: { contains: q } } } },
      ],
    } : {}),
  };
  const resultWhere: Prisma.ResultWhereInput = {
    ...scope,
    ...(drawId ? { drawId } : {}),
    ...(enteredBy ? { makerId: enteredBy } : {}),
    ...(q ? { value: { contains: q } } : {}),
    ...(check === "PASSED" ? { status: "APPROVED" }
      : check === "PENDING" ? { status: "DRAFT" }
        : check === "REJECTED" ? { status: "REJECTED" }
          : {}),
  };

  const [draws, users, resultGroups, totalBillCount] = await Promise.all([
    prisma.draw.findMany({ where: scope, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true } }),
    prisma.user.findMany({
      where: { ...scope, role: { in: ["OWNER", "ADMIN", "AGENT"] } },
      orderBy: { displayName: "asc" },
      select: { id: true, displayName: true, role: true },
    }),
    prisma.result.groupBy({ by: ["status"], where: resultWhere, _count: { _all: true } }),
    prisma.bill.count({ where: billWhere }),
  ]);

  const resultCounts = new Map(resultGroups.map((row) => [row.status, row._count._all]));
  const totalResultCount = resultGroups.reduce((sum, row) => sum + row._count._all, 0);
  const totalRows = view === "results" ? totalResultCount : totalBillCount;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);
  const skip = (page - 1) * PAGE_SIZE;

  const results = view === "results" ? await prisma.result.findMany({
    where: resultWhere,
    orderBy: [{ enteredAt: "desc" }, { id: "desc" }],
    skip,
    take: PAGE_SIZE,
    select: {
      id: true, value: true, version: true, status: true, enteredAt: true, checkedAt: true, rejectReason: true,
      draw: { select: { id: true, name: true } },
      prizeType: { select: { code: true, name: true, digits: true } },
      maker: { select: { displayName: true } },
      checker: { select: { displayName: true } },
    },
  }) : [];

  const bills = view === "bills" ? await prisma.bill.findMany({
    where: billWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take: PAGE_SIZE,
    select: {
      id: true, billNumber: true, title: true, status: true, createdAt: true, totalStake: true,
      draw: { select: { id: true, name: true } },
      agent: { select: { code: true } },
      createdBy: { select: { displayName: true, role: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, number: true, stake: true, payoutRateSnapshot: true, prizeTypeId: true,
          prizeType: { select: { code: true, name: true, digits: true } },
        },
      },
    },
  }) : [];

  const billRows = bills.map((bill) => {
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const item of bill.items) {
      if (!/^\d+$/.test(item.number) || item.number.length !== item.prizeType.digits) {
        problems.push(`${item.prizeType.name}: เลข ${item.number} ไม่ครบ ${item.prizeType.digits} หลัก`);
      }
      if (Number(item.stake) <= 0) problems.push(`${item.prizeType.name}: ยอดเดิมพันไม่ถูกต้อง`);
      const key = `${item.prizeTypeId}:${item.number}`;
      if (seen.has(key)) problems.push(`${item.prizeType.name}: เลข ${item.number} ซ้ำในบิล`);
      seen.add(key);
    }
    return { ...bill, problems };
  }).filter((bill) => check !== "REJECTED" || bill.problems.length > 0)
    .filter((bill) => check !== "PASSED" || bill.problems.length === 0);

  const pageStart = totalRows === 0 ? 0 : skip + 1;
  const displayedRows = view === "results" ? results.length : billRows.length;
  const pageEnd = Math.min(skip + displayedRows, totalRows);
  const pagination = totalPages > 1 ? <nav className="inspection-pagination" aria-label="แบ่งหน้าประวัติ">
    <span>แสดง {pageStart.toLocaleString("th-TH")}–{pageEnd.toLocaleString("th-TH")} จาก {totalRows.toLocaleString("th-TH")} รายการ</span>
    <div>
      {page > 1 ? <Link href={href({ page: String(page - 1) })}>← ก่อนหน้า</Link> : <span>← ก่อนหน้า</span>}
      <b>หน้า {page.toLocaleString("th-TH")} / {totalPages.toLocaleString("th-TH")}</b>
      {page < totalPages ? <Link href={href({ page: String(page + 1) })}>ถัดไป →</Link> : <span>ถัดไป →</span>}
    </div>
  </nav> : null;

  return <main className="workspace-page inspection-page"><section className="card workspace-card">
    <p><Link href="/">← หน้าภาพรวม</Link></p>
    <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Bill & Result Inspection</p><h1>ประวัติการตรวจผลรางวัล</h1><p>เลือกดูเฉพาะข้อมูลที่ต้องการ ระบบโหลดครั้งละ {PAGE_SIZE} รายการ</p></div><span className="audit-readonly"><DashboardIcon name="lock" /> อ่านอย่างเดียว<small>ข้อมูลต้นทางแก้ไขจากหน้านี้ไม่ได้</small></span></header>

    <section className="audit-kpis"><article><span>ผลรางวัลที่พบ</span><strong>{totalResultCount.toLocaleString("th-TH")}</strong><small>ตามตัวกรองปัจจุบัน</small></article><article><span>ตรวจแล้ว</span><strong>{(resultCounts.get("APPROVED") ?? 0).toLocaleString("th-TH")}</strong><small>ผ่านการอนุมัติ</small></article><article className={(resultCounts.get("DRAFT") ?? 0) ? "danger" : ""}><span>รอตรวจ</span><strong>{(resultCounts.get("DRAFT") ?? 0).toLocaleString("th-TH")}</strong><small>ยังไม่ยืนยัน</small></article><article><span>บิลที่พบ</span><strong>{totalBillCount.toLocaleString("th-TH")}</strong><small>เปิดดูแยกอีกมุมมอง</small></article></section>

    <AuditFilters draws={draws.map((draw) => ({ id: draw.id, label: draw.name }))} users={users.map((user) => ({ id: user.id, label: `${user.displayName} · ${user.role}` }))} />

    <nav className="inspection-view-tabs" aria-label="เลือกประเภทประวัติ"><Link className={view === "results" ? "active" : ""} href={href({ view: null, page: null })}><span>ผลรางวัล</span><small>เลขรางวัลและผู้ยืนยัน</small></Link><Link className={view === "bills" ? "active" : ""} href={href({ view: "bills", page: null })}><span>บิลที่คีย์</span><small>เปิดดูเมื่อต้องตรวจเลขในบิล</small></Link></nav>

    {view === "results" ? <section className="inspection-section inspection-section-primary"><div className="inspection-heading"><div><p className="page-eyebrow">Result Verification</p><h2>ประวัติผลรางวัลที่กรอก</h2></div><span>{results.length} รายการในหน้านี้</span></div><div className="audit-table-wrap"><table className="inspection-table"><thead><tr><th>งวด</th><th>ประเภทรางวัล</th><th>ผลรางวัล</th><th>ผู้บันทึก</th><th>เวลาที่บันทึก</th><th>สถานะ</th><th>ผู้ยืนยัน / เวลา</th></tr></thead><tbody>{results.map((result) => <tr key={result.id}><td><Link href={`/draws/${result.draw.id}`}>{result.draw.name}</Link></td><td>{result.prizeType.code}. {result.prizeType.name}<small>{result.prizeType.digits} หลัก · เวอร์ชัน {result.version}</small></td><td><strong className="keyed-number">{result.value}</strong></td><td>{result.maker.displayName}</td><td>{DATE_TIME.format(result.enteredAt)}</td><td><span className={`inspection-status status-${result.status.toLowerCase()}`}>{RESULT_LABEL[result.status]}</span>{result.rejectReason && <small>{result.rejectReason}</small>}</td><td>{result.checker?.displayName ?? "—"}<small>{result.checkedAt ? DATE_TIME.format(result.checkedAt) : "ยังไม่ยืนยัน"}</small></td></tr>)}</tbody></table></div>{results.length === 0 && <p className="audit-empty">ไม่พบประวัติผลรางวัล</p>}{pagination}</section>
      : <section className="inspection-section inspection-section-primary"><div className="inspection-heading"><div><p className="page-eyebrow">Bill Keying History</p><h2>บิลและเลขที่คีย์</h2></div><span>{billRows.length} บิลในหน้านี้</span></div><div className="bill-inspection-list">{billRows.map((bill) => <details key={bill.id}><summary><div><strong>{bill.billNumber ?? "บิลร่าง"}</strong><small>{bill.title}</small></div><div><span>งวด</span><strong>{bill.draw.name}</strong></div><div><span>ผู้กรอก</span><strong>{bill.createdBy.displayName}</strong><small>{bill.createdBy.role}</small></div><div><span>Agent</span><strong>{bill.agent.code}</strong></div><div><span>จำนวนเลข</span><strong>{bill.items.length}</strong></div><div><span>ผลตรวจระบบ</span><b className={bill.problems.length ? "check-issue" : "check-passed"}>{bill.problems.length ? `พบ ${bill.problems.length} จุด` : "ผ่านกฎ"}</b></div><i>⌄</i></summary><div className="bill-inspection-detail"><header><span>คีย์เมื่อ {DATE_TIME.format(bill.createdAt)}</span><span>สถานะ {statusLabel(bill.status)}</span><span>ยอดรวม {bill.totalStake.toFixed(2)} บาท</span><Link href={`/bills/${bill.id}`}>เปิดบิลเต็ม →</Link></header>{bill.problems.length > 0 && <ul>{bill.problems.map((problem, index) => <li key={`${problem}-${index}`}>{problem}</li>)}</ul>}<div className="table-wrap"><table><thead><tr><th>#</th><th>ประเภทรางวัล</th><th>เลขที่คีย์</th><th>จำนวนหลักที่ต้องการ</th><th className="num">ยอดเดิมพัน</th><th className="num">อัตราจ่าย Snapshot</th></tr></thead><tbody>{bill.items.map((item, index) => <tr key={item.id}><td>{index + 1}</td><td>{item.prizeType.code}. {item.prizeType.name}</td><td><strong className="keyed-number">{item.number}</strong></td><td>{item.prizeType.digits} หลัก</td><td className="num">{item.stake.toFixed(2)}</td><td className="num">{bill.status === "DRAFT" ? "ยังไม่ล็อก" : item.payoutRateSnapshot.toFixed(4)}</td></tr>)}</tbody></table></div></div></details>)}</div>{billRows.length === 0 && <p className="audit-empty">ไม่พบบิลที่ตรงกับตัวกรอง</p>}{pagination}</section>}

    <aside className="audit-integrity-note"><strong>วิธีอ่านประวัติ</strong><p>หน้าแรกจะแสดงเฉพาะผลรางวัล หากต้องตรวจเลขในบิลให้เลือก “บิลที่คีย์” ระบบจะโหลดรายละเอียดเมื่อเปิดมุมมองนั้นเท่านั้น</p></aside>
  </section></main>;
}

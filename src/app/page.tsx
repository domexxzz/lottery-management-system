import Link from "next/link";
import { redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
import { permissionsFor } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { ManagementDashboard } from "./ManagementDashboard";
import { DashboardIcon as Icon } from "./DashboardIcon";
import { CheckerDashboard } from "./CheckerDashboard";

const ROLE_LABEL: Record<string, string> = {
  OWNER: "เจ้าของกิจการ",
  ADMIN: "ผู้ดูแลระบบ",
  CHECKER: "ผู้ตรวจสอบ",
  AGENT: "ตัวแทน",
};
const DRAW_STATUS_LABEL: Record<string, string> = { OPEN: "เปิดรับบิล", LOCKED: "ปิดรับแล้ว", RESULT_PENDING: "รอตรวจผล", SETTLED: "คำนวณแล้ว", CLOSED: "ปิดบัญชีแล้ว" };

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  if (actor.role === "OWNER" || actor.role === "ADMIN") {
    const query = await searchParams;
    const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
    return <ManagementDashboard actor={actor} filters={{
      drawId: first(query.drawId),
      agentId: first(query.agentId),
      status: first(query.status),
      dateFrom: first(query.dateFrom),
      dateTo: first(query.dateTo),
    }} />;
  }

  if (actor.role === "CHECKER") return <CheckerDashboard actor={actor} />;

  const permissions = permissionsFor(actor.role);
  const billScope = { ...orgScope(actor), ...(actor.role === "AGENT" ? { agentId: actor.agentId ?? "__none__" } : {}) };
  const [currentDraw, bills] = await Promise.all([
    prisma.draw.findFirst({ where: { ...orgScope(actor), status: { in: ["OPEN", "LOCKED", "RESULT_PENDING", "SETTLED"] } }, orderBy: { cutoffAt: "desc" }, select: { id: true, name: true, status: true, cutoffAt: true } }),
    prisma.bill.findMany({ where: { ...billScope, status: { in: ["CONFIRMED", "LOCKED", "SETTLED"] } }, select: { totalStake: true, totalPayout: true, status: true } }),
  ]);
  const gross = bills.reduce((sum, bill) => sum + Number(bill.totalStake), 0);
  const payout = bills.reduce((sum, bill) => sum + Number(bill.totalPayout), 0);
  const actions = [
    ...(permissions.includes("bill.create") ? [{ href: "/bills/new", icon: "plus" as const, label: "สร้างบิลใหม่", detail: "เพิ่มรายการรับแทง" }] : []),
    { href: "/bills", icon: "bill" as const, label: "รายการบิล", detail: "ค้นหาและติดตามสถานะ" },
    { href: "/draws", icon: "draw" as const, label: "รอบ", detail: "ดูสถานะรอบปัจจุบัน" },
    { href: "/reports", icon: "report" as const, label: "รายงาน", detail: "ตรวจยอดและผลรวม" },
  ];

  return (
    <div className="dashboard-body role-dashboard">
      <div className="welcome-row"><div><p className="eyebrow">{ROLE_LABEL[actor.role]}</p><h1 id="home-heading">สวัสดี {actor.displayName}</h1><p>ติดตามบิลและยอดขายของคุณได้จากหน้านี้</p></div>{currentDraw && <Link href={`/draws/${currentDraw.id}`} className="current-draw"><span>รอบปัจจุบัน</span><strong>{currentDraw.name}</strong><small>{DRAW_STATUS_LABEL[currentDraw.status] ?? currentDraw.status}</small><Icon name="arrow"/></Link>}</div>
      <section className="role-kpi-grid"><article><span><Icon name="bill"/></span><div><small>บิลที่เกี่ยวข้อง</small><strong>{bills.length}</strong><p>บิลที่มีผลทางการเงิน</p></div></article><article><span><Icon name="report"/></span><div><small>ยอดขายรวม</small><strong>{gross.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</strong><p>บาท</p></div></article><article><span><Icon name="draw"/></span><div><small>จ่ายรางวัล</small><strong>{payout.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</strong><p>บาท</p></div></article></section>
      <section className="role-workspace"><div className="dashboard-panel"><div className="panel-heading"><div><p className="eyebrow">เมนูหลัก</p><h2>งานของคุณ</h2></div></div><div className="role-action-grid">{actions.map((action) => <Link href={action.href} key={action.href}><span><Icon name={action.icon}/></span><div><strong>{action.label}</strong><small>{action.detail}</small></div><Icon name="arrow"/></Link>)}</div></div><div className="dashboard-panel role-guide"><p className="eyebrow">ขั้นตอนถัดไป</p><h2>จัดการบิลของคุณ</h2><p>สร้างบิล ตรวจรายการให้ครบ และยืนยันก่อนเวลาปิดรับ</p><Link href="/bills/new">เริ่มดำเนินการ <Icon name="arrow"/></Link></div></section>
    </div>
  );
}

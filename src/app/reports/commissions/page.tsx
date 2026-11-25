import Link from "next/link";
import { redirect } from "next/navigation";
import { DashboardIcon } from "@/app/DashboardIcon";
import { DashboardLotteryDrawFilter } from "@/app/DashboardLotteryDrawFilter";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { dashboardDrawLabel } from "@/lib/dashboard/lottery-draw-filter";
import { loadCommissionPayoutReport } from "@/lib/reports/commission-payout";
import { currentCommissionMonth } from "@/lib/reports/commission-period";
import { parseDay } from "@/lib/draws/range";
import { reportCategoryLabel } from "@/lib/reports/draw-groups";
import { CommissionPeriodFilter } from "./CommissionPeriodFilter";
import { CommissionPaymentToggle } from "./CommissionPaymentToggle";
import "./commissions.css";

export const dynamic = "force-dynamic";

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("th-TH");
const DATE_TIME = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" });

const statusOf = (row: { draftCount: number; reconciledCount: number; approvedCount: number }) => {
  if (row.draftCount > 0) return { tone: "review", label: `รอตรวจสอบ ${row.draftCount} งวด` };
  if (row.reconciledCount > 0) return { tone: "ready", label: `ตรวจสอบแล้ว ${row.reconciledCount} งวด` };
  return { tone: "closed", label: `ปิดบัญชีแล้ว ${row.approvedCount} งวด` };
};

export default async function CommissionPayoutPage({ searchParams }: {
  searchParams: Promise<{ lottery?: string; drawId?: string; period?: string; date?: string; dateFrom?: string; dateTo?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");
  if (!can(actor.role, "report.viewAllAgents")) redirect("/reports");
  const query = await searchParams;
  const legacyDay = query.period === "day" ? parseDay(query.date) : undefined;
  const selectedFrom = query.period === "range" ? parseDay(query.dateFrom) : legacyDay;
  const selectedTo = query.period === "range" ? parseDay(query.dateTo) : legacyDay;
  const selectedMonth = query.period === "month" && /^\d{4}-\d{2}$/.test(query.date ?? "") ? query.date! : currentCommissionMonth();
  const effectiveQuery = selectedFrom || selectedTo
    ? { ...query, period: "range", dateFrom: selectedFrom, dateTo: selectedTo }
    : { ...query, period: "month", date: selectedMonth };
  const report = await loadCommissionPayoutReport(actor, effectiveQuery);

  return <main className="commission-page">
    <header className="commission-head">
      <div>
        <p><Link href="/reports">รายงาน</Link> / จ่ายค่าคอม</p>
        <h1>รายการเตรียมจ่ายค่าคอม Agent</h1>
        <span>{report.scopeLabel} · ใช้ยอด Settlement ที่คำนวณแล้วเท่านั้น</span>
      </div>
      <div className="commission-head-total"><small>ยอดที่ต้องจ่ายค่าคอมรวม</small><strong>{MONEY.format(report.totals.commission)}</strong><span>บาท</span></div>
    </header>

    <DashboardLotteryDrawFilter
      className="commission-filter"
      draws={report.scope.logicalDraws.map((draw) => ({ id: draw.id, label: `${reportCategoryLabel(draw.category)} · ${dashboardDrawLabel(draw)}`, lotteryType: draw.lotteryType, category: draw.category, status: draw.status }))}
      category={report.scope.category}
      selectedDrawId={report.scope.selectedDraw?.id}
    />

    <CommissionPeriodFilter
      mode={report.period.mode === "range" ? "range" : "month"}
      startDate={report.period.mode === "range" ? report.period.from ?? "" : ""}
      endDate={report.period.mode === "range" ? report.period.to ?? "" : ""}
      month={report.period.mode === "month" ? report.period.value ?? selectedMonth : selectedMonth}
    />

    {report.checklist && <section className="commission-check-summary" aria-label="ความคืบหน้าการจ่ายค่าคอมรายเดือน">
      <div><small>จ่ายแล้ว</small><strong>{COUNT.format(report.checklist.paidAgents)} / {COUNT.format(report.rows.length)} Agent</strong></div>
      <div><small>ยอดที่ทำเครื่องหมายจ่ายแล้ว</small><strong>{MONEY.format(report.checklist.paidAmount)} บาท</strong></div>
      <div className="is-pending"><small>ยังต้องจ่าย</small><strong>{COUNT.format(report.checklist.pendingAgents)} Agent · {MONEY.format(report.checklist.pendingAmount)} บาท</strong></div>
      <div className="commission-progress" aria-label={`จ่ายแล้ว ${report.rows.length ? Math.round(report.checklist.paidAgents / report.rows.length * 100) : 0}%`}><span style={{ width: `${report.rows.length ? report.checklist.paidAgents / report.rows.length * 100 : 0}%` }} /></div>
    </section>}
    {report.period.mode === "month" && !report.checklistEnabled && <p className="commission-check-hint">หากต้องการติ๊กจ่ายค่าคอมรายเดือน ให้เลือก “ทุกประเภท” และ “รวมทุกงวด” เพื่อป้องกันการจ่ายเพียงบางส่วนโดยไม่ตั้งใจ</p>}

    <section className="commission-summary" aria-label="สรุปยอดสำหรับจ่ายค่าคอม">
      <article><span><DashboardIcon name="bill" /></span><div><small>ยอดขายที่คำนวณแล้ว</small><strong>{MONEY.format(report.totals.gross)}</strong><p>บาท</p></div></article>
      <article><span><DashboardIcon name="winner" /></span><div><small>จ่ายรางวัล</small><strong>{MONEY.format(report.totals.payout)}</strong><p>บาท</p></div></article>
      <article className="commission-highlight"><span><DashboardIcon name="agent" /></span><div><small>ค่าคอม Agent</small><strong>{MONEY.format(report.totals.commission)}</strong><p>ไทย {MONEY.format(report.totals.thaiCommission)} · ลาว {MONEY.format(report.totals.laoCommission)}</p></div></article>
      <article className={report.totals.net < 0 ? "is-loss" : "is-profit"}><span><DashboardIcon name="analytics" /></span><div><small>สุทธิที่ธุรกิจได้</small><strong>{report.totals.net < 0 ? "−" : "+"}{MONEY.format(Math.abs(report.totals.net))}</strong><p>ยอดขาย − รางวัล − ค่าคอม</p></div></article>
    </section>

    <section className="commission-list">
      <header><div><p>{report.checklistEnabled ? "MONTHLY COMMISSION CHECKLIST" : "COMMISSION PAYABLE"}</p><h2>{report.checklistEnabled ? "เช็กลิสต์จ่ายค่าคอมรายเดือน" : "ต้องจ่ายให้ Agent คนไหนเท่าไหร่"}</h2></div><span>{COUNT.format(report.rows.length)} Agent</span></header>
      {report.rows.length === 0 ? <p className="commission-empty">ยังไม่มี Settlement ที่คำนวณแล้วในขอบเขตนี้</p> : <div className="commission-table-wrap"><table>
        <thead><tr><th>Agent</th><th className="num">งวด</th><th className="num">ยอดขาย</th><th className="num">จ่ายรางวัล</th><th className="num">คอมหวยไทย</th><th className="num">คอมหวยลาวและชุด</th><th className="num">ต้องจ่ายรวม</th><th className="num">สุทธิธุรกิจ</th><th>{report.checklistEnabled ? "เช็กการจ่าย" : "สถานะ"}</th></tr></thead>
        <tbody>{report.rows.map((row) => { const status = statusOf(row); return <tr key={row.agentId}>
          <td data-label="Agent"><Link href={`/agents/${row.agentId}`}><strong>{row.code}</strong><span>{row.name}</span></Link></td>
          <td data-label="งวด" className="num">{COUNT.format(row.drawCount)}</td>
          <td data-label="ยอดขาย" className="num">{MONEY.format(row.gross)}</td>
          <td data-label="จ่ายรางวัล" className="num">{MONEY.format(row.payout)}</td>
          <td data-label="คอมหวยไทย" className="num">{MONEY.format(row.thaiCommission)}<small>{row.thaiRate.toFixed(0)}%</small></td>
          <td data-label="คอมหวยลาวและชุด" className="num">{MONEY.format(row.laoCommission)}<small>{row.laoRate.toFixed(0)}%</small></td>
          <td data-label="ต้องจ่ายรวม" className="num commission-payable"><strong>{MONEY.format(row.commission)}</strong><small>บาท</small></td>
          <td data-label="สุทธิธุรกิจ" className={`num ${row.net < 0 ? "is-loss" : "is-profit"}`}>{row.net < 0 ? "−" : "+"}{MONEY.format(Math.abs(row.net))}</td>
          <td data-label={report.checklistEnabled ? "เช็กการจ่าย" : "สถานะ"}>{report.checklistEnabled && report.period.value
            ? <CommissionPaymentToggle
                agentId={row.agentId}
                month={report.period.value}
                payment={row.payment ? { paidAtLabel: DATE_TIME.format(row.payment.paidAt), paidByName: row.payment.paidByName, snapshotTotal: row.payment.snapshotTotal, difference: row.payment.difference } : null}
              />
            : <span className={`commission-status ${status.tone}`}>{status.label}</span>}
          </td>
        </tr>; })}</tbody>
        <tfoot><tr><th colSpan={2}>รวม {COUNT.format(report.rows.length)} Agent</th><td className="num">{MONEY.format(report.totals.gross)}</td><td className="num">{MONEY.format(report.totals.payout)}</td><td className="num">{MONEY.format(report.totals.thaiCommission)}</td><td className="num">{MONEY.format(report.totals.laoCommission)}</td><td className="num commission-payable">{MONEY.format(report.totals.commission)}</td><td className={`num ${report.totals.net < 0 ? "is-loss" : "is-profit"}`}>{report.totals.net < 0 ? "−" : "+"}{MONEY.format(Math.abs(report.totals.net))}</td><td /></tr></tfoot>
      </table></div>}
      <p className="commission-note">การติ๊ก “จ่ายแล้ว” คือการบันทึกเช็กลิสต์และยอด snapshot เพื่อใช้ตรวจสอบย้อนหลัง ระบบไม่ได้โอนเงินจริงหรือตัดเงินให้อัตโนมัติ</p>
    </section>
  </main>;
}

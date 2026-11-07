import Link from "next/link";
import { DashboardIcon } from "../DashboardIcon";
import { LockDrawForm } from "./DrawForms";
import { DrawReviewButton } from "./DrawReviewButton";
import type { listDraws } from "@/lib/draws/service";

const BANGKOK = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export const DRAW_STATUS_LABEL: Record<string, string> = {
  OPEN: "เปิดรับ",
  LOCKED: "ปิดรับแล้ว",
  RESULT_PENDING: "รอผล",
  SETTLED: "คำนวณแล้ว",
  RECONCILED: "ตรวจสอบยอดแล้ว",
  CLOSED: "ปิดบัญชี",
};

export type DrawRow = Awaited<ReturnType<typeof listDraws>>[number];

export function getDrawDisplayStatus(draw: DrawRow): string {
  const reconciled = draw.status === "SETTLED"
    && draw.settlements.length > 0
    && draw.settlements.every((settlement) => (
      settlement.status === "RECONCILED" || settlement.status === "APPROVED"
    ));

  return reconciled ? "RECONCILED" : draw.status;
}

export function DrawTable({
  draws,
  canEnterResults,
  canReviewResults,
  canManage,
}: {
  draws: DrawRow[];
  canEnterResults: boolean;
  canReviewResults: boolean;
  canManage: boolean;
}) {
  const columnCount = 5 + Number(canEnterResults) + Number(canReviewResults) + Number(canManage);

  return <div className="table-wrap"><table className="draw-list-table">
    <thead>
      <tr>
        <th scope="col">ชื่อรอบ</th>
        <th scope="col">เปิดรับ</th>
        <th scope="col">ปิดรับ</th>
        <th scope="col">บิล</th>
        <th scope="col">สถานะ</th>
        {canEnterResults && <th scope="col">กรอกผลรางวัล</th>}
        {canReviewResults && <th scope="col">ตรวจผลรางวัล</th>}
        {canManage && <th scope="col">การจัดการ</th>}
      </tr>
    </thead>
    <tbody>
      {draws.length === 0 && <tr><td colSpan={columnCount} className="draw-empty-row">ยังไม่มีรอบในระบบ</td></tr>}
      {draws.map((draw) => {
        const displayStatus = getDrawDisplayStatus(draw);
        return <tr key={draw.id} className={displayStatus === "RECONCILED" ? "draw-row-reconciled" : undefined}>
          <td><Link href={`/draws/${draw.id}`}>{draw.name}</Link></td>
          <td>{BANGKOK.format(draw.opensAt)}</td>
          <td>{BANGKOK.format(draw.cutoffAt)}</td>
          <td>{draw._count.bills}</td>
          <td>
            <span className={`status-pill ${displayStatus === "RECONCILED" ? "reconciled" : draw.status === "OPEN" || draw.status === "CLOSED" ? "success" : draw.status === "RESULT_PENDING" ? "warning" : "info"}`}>
              {displayStatus === "RECONCILED" && <span aria-hidden="true">✓ </span>}
              {DRAW_STATUS_LABEL[displayStatus] ?? displayStatus}
            </span>
            {draw.lockedAt !== null && <span className="muted"> · {BANGKOK.format(draw.lockedAt)}</span>}
          </td>
          {canEnterResults && <td className="draw-result-cell">
            {draw.status === "OPEN" ? <span className="draw-result-locked" title="ต้องปิดรอบก่อนจึงจะกรอกผลรางวัลได้">
              <DashboardIcon name="lock" /> ปิดรอบก่อน
            </span> : <Link href={`/draws/${draw.id}#result-entry-list`} className="draw-result-button" aria-label={`กรอกผลรางวัลรอบ ${draw.name}`}>
              <DashboardIcon name="edit" />
              {draw.status === "LOCKED" || draw.status === "RESULT_PENDING" ? "กรอกผลรางวัล" : "ดูผลรางวัล"}
            </Link>}
          </td>}
          {canReviewResults && <td className="draw-review-cell">
            {draw.status === "OPEN" ? <button type="button" className="draw-review-waiting" title="ต้องปิดรอบก่อนจึงจะตรวจผลรางวัลได้" disabled>
              <DashboardIcon name="lock" /> ปิดรอบก่อน
            </button> : draw.status === "LOCKED" ? <button type="button" className="draw-review-waiting" title="ยังไม่มีผลรางวัลส่งให้ตรวจ" disabled>
              <span aria-hidden="true">…</span> รอกรอกผล
            </button> : <DrawReviewButton href={`/draws/${draw.id}#result-entry-list`} drawName={draw.name} label={draw.status === "RESULT_PENDING" ? "ตรวจผลรางวัล" : "ดูผลรางวัล"} />}
          </td>}
          {canManage && <td>{draw.status === "OPEN" && <LockDrawForm drawId={draw.id} />}</td>}
        </tr>;
      })}
    </tbody>
  </table></div>;
}

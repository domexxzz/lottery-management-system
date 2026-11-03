import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { listResults } from "@/lib/results/service";
import { listSettlements } from "@/lib/settlement/service";
import { NotFoundError } from "@/lib/errors";
import {
  ApproveResultForm,
  ApproveSettlementForm,
  CalculateForm,
  EnterResultForm,
  ReconcileForm,
  RejectResultForm,
} from "./DrawForms";
import "./draw-detail.css";

export const dynamic = "force-dynamic";

const DRAW_STATUS: Record<string, string> = {
  OPEN: "เปิดรับ",
  LOCKED: "ปิดรับแล้ว",
  RESULT_PENDING: "รอผลและการอนุมัติ",
  SETTLED: "คำนวณแล้ว รอปิดบัญชี",
  CLOSED: "ปิดบัญชีแล้ว",
};

const RESULT_STATUS: Record<string, string> = {
  DRAFT: "รอตรวจ",
  APPROVED: "อนุมัติแล้ว",
  REJECTED: "ตีกลับ",
};

const SETTLEMENT_STATUS: Record<string, string> = {
  DRAFT: "รอกระทบยอด",
  RECONCILED: "กระทบยอดแล้ว",
  APPROVED: "ปิดบัญชีแล้ว",
};

const MATCH_HINT: Record<string, string> = {
  EXACT: "เลขที่ออก",
  PERMUTATION: "เลขที่ออก",
  CONTAINS_DIGIT: "เลขต้นทาง เช่น 3 ตัวบน",
};

export default async function DrawDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword) redirect("/change-password");

  const { id } = await params;

  let results;
  let settlementData;
  try {
    [results, settlementData] = await Promise.all([
      listResults(actor, id),
      listSettlements(actor, id),
    ]);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const { draw, prizeTypes, latestByPrizeType } = results;
  const canEnter = can(actor.role, "result.enter");
  const canApproveResult = can(actor.role, "result.approve");
  const canCalculate = can(actor.role, "settlement.calculate");
  const canReconcile = can(actor.role, "settlement.reconcile");
  const canApproveSettlement = can(actor.role, "settlement.approve");

  const approvedCount = [...latestByPrizeType.values()].filter(
    (r) => r.status === "APPROVED",
  ).length;

  return (
    <main>
      <section className="card" aria-labelledby="draw-heading">
        <p>
          <Link href="/draws">← กลับไปรายการรอบ</Link>
        </p>
        <h1 id="draw-heading">{draw.name}</h1>
        <p className="muted">
          สถานะ {DRAW_STATUS[draw.status] ?? draw.status} · อนุมัติผลแล้ว {approvedCount} จาก{" "}
          {prizeTypes.length} ประเภท
        </p>

        <h2>ผลรางวัล</h2>
        {draw.status === "OPEN" ? (
          <p className="muted">รอบนี้ยังเปิดรับอยู่ ลงผลได้หลังปิดรับ</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">รางวัล</th>
                <th scope="col">ผลที่กรอก</th>
                <th scope="col">สถานะ</th>
                <th scope="col">ผู้กรอก / ผู้ตรวจ</th>
                <th scope="col">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {prizeTypes.map((pt) => {
                const latest = latestByPrizeType.get(pt.id);
                const locked = draw.status === "CLOSED" || latest?.status === "APPROVED";

                return (
                  <tr key={pt.id}>
                    <td>
                      {pt.code}. {pt.name}
                      <span className="muted"> ({pt.digits} หลัก)</span>
                    </td>
                    <td className="number-cell">{latest?.value ?? "-"}</td>
                    <td>
                      {latest ? (RESULT_STATUS[latest.status] ?? latest.status) : "ยังไม่กรอก"}
                      {latest?.rejectReason != null && (
                        <span className="muted"> · {latest.rejectReason}</span>
                      )}
                    </td>
                    <td className="muted">
                      {latest?.maker.displayName ?? "-"}
                      {latest?.checker != null && ` / ${latest.checker.displayName}`}
                    </td>
                    <td>
                      {canEnter && !locked && (
                        <EnterResultForm
                          drawId={draw.id}
                          prizeTypeId={pt.id}
                          code={pt.code}
                          currentValue={latest?.status === "DRAFT" ? latest.value : ""}
                          hint={MATCH_HINT[pt.matchRule] ?? "เลขที่ออก"}
                        />
                      )}
                      {canApproveResult && latest?.status === "DRAFT" && (
                        <>
                          <ApproveResultForm drawId={draw.id} resultId={latest.id} />
                          <RejectResultForm drawId={draw.id} resultId={latest.id} />
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <h2>สรุปการเงิน</h2>

        {canCalculate && draw.status !== "CLOSED" && approvedCount > 0 && (
          <CalculateForm drawId={draw.id} />
        )}

        {settlementData.settlements.length === 0 ? (
          <p className="muted">ยังไม่ได้คำนวณ</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col" className="num">ยอดขาย</th>
                  <th scope="col" className="num">จ่ายรางวัล</th>
                  <th scope="col" className="num">คอม</th>
                  <th scope="col" className="num">สุทธิ</th>
                  <th scope="col">สถานะ</th>
                  {canReconcile && <th scope="col">การจัดการ</th>}
                </tr>
              </thead>
              <tbody>
                {settlementData.settlements.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.agent.code} {s.agent.name}
                    </td>
                    <td className="num">{s.gross.toFixed(2)}</td>
                    <td className="num">{s.payout.toFixed(2)}</td>
                    <td className="num">
                      {s.commission.toFixed(2)}
                      <span className="muted"> ({s.commissionRateSnapshot.toFixed(2)}%)</span>
                    </td>
                    <td className={s.net.isNegative() ? "num error" : "num"}>
                      {s.net.toFixed(2)}
                    </td>
                    <td>{SETTLEMENT_STATUS[s.status] ?? s.status}</td>
                    {canReconcile && (
                      <td>
                        {s.status === "DRAFT" && (
                          <ReconcileForm drawId={draw.id} settlementId={s.id} />
                        )}
                        {s.reconciledBy != null && (
                          <span className="muted">{s.reconciledBy.displayName}</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>

            {canReconcile && (
              <p>
                <a href={`/api/draws/${draw.id}/reconciliation`}>
                  ดาวน์โหลดไฟล์กระทบยอด (CSV)
                </a>
              </p>
            )}

            {canApproveSettlement && draw.status === "SETTLED" && (
              <ApproveSettlementForm drawId={draw.id} />
            )}
          </>
        )}
      </section>
    </main>
  );
}

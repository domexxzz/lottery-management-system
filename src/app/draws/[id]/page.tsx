import Link from "next/link";
import { DashboardIcon } from "../../DashboardIcon";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { expectedResultLength } from "@/lib/results/matching";
import { listResults } from "@/lib/results/service";
import { displayResultValues, resultValueCount, storedResultValues } from "@/lib/results/values";
import { listSettlements } from "@/lib/settlement/service";
import { NotFoundError } from "@/lib/errors";
import { officialDrawName, recentOfficialDrawDates } from "@/lib/draws/schedule";
import {
  ApproveResultForm,
  ApproveSettlementForm,
  CalculateForm,
  ProposeCorrectionForm,
  RejectResultForm,
  SaveAllResultsForm,
} from "./DrawForms";
import { GloResultImporter } from "./GloResultImporter";
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
  DRAFT: "คำนวณแล้ว",
  RECONCILED: "คำนวณแล้ว",
  APPROVED: "ปิดบัญชีแล้ว",
};

const MATCH_HINT: Record<string, string> = {
  EXACT: "เลขที่ออก",
  PERMUTATION: "เลขที่ออก",
  CONTAINS_DIGIT: "เลขวิ่ง 1 หลัก",
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

  const { draw, prizeTypes, latestByPrizeType, approvedByPrizeType } = results;
  const canEnter = can(actor.role, "result.enter");
  const canApproveResult = can(actor.role, "result.approve");
  const canProposeCorrection = can(actor.role, "result.proposeCorrection");
  const canCalculate = can(actor.role, "settlement.calculate");
  const canApproveSettlement = can(actor.role, "settlement.approve");

  const approvedCount = approvedByPrizeType.size;
  const bulkFormId = "bulk-result-form";
  const editableCount = prizeTypes.filter((pt) => !approvedByPrizeType.has(pt.id)).length;
  const pendingCorrections = prizeTypes.filter(
    (pt) => approvedByPrizeType.has(pt.id) && latestByPrizeType.get(pt.id)?.status === "DRAFT",
  ).length;
  const gloDateOptions = recentOfficialDrawDates(new Date(), 24).map((date) => ({
    value: date,
    label: officialDrawName(date) ?? date,
  }));

  return (
    <main className="workspace-page draw-detail-page">
      <section className="card workspace-card" aria-labelledby="draw-heading">
        <p><Link href="/draws">← กลับไปรายการงวด</Link></p>
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Draw & Settlement</p><h1 id="draw-heading">{draw.name}</h1><p>บันทึกผลและคำนวณ Settlement จากข้อมูลจริงของงวด</p></div><span className={`status-pill ${draw.status === "CLOSED" ? "success" : draw.status === "RESULT_PENDING" ? "warning" : "info"}`}>{DRAW_STATUS[draw.status] ?? draw.status}</span></header>
        <div className="draw-detail-summary"><div><span>ผลที่อนุมัติแล้ว</span><strong>{approvedCount} / {prizeTypes.length}</strong></div><div><span>Settlement</span><strong>{settlementData.settlements.length}</strong><small>Agent</small></div><div><span>สถานะงวด</span><strong>{DRAW_STATUS[draw.status] ?? draw.status}</strong></div></div>

        <h2>ผลรางวัล</h2>
        {draw.status === "OPEN" ? (
          <p className="muted">งวดนี้ยังเปิดรับอยู่ ลงผลได้หลังปิดรับ</p>
        ) : (
          <>
          {pendingCorrections > 0 && (
            <p className="notice" role="status">
              มีคำขอแก้ผลรางวัลรออนุมัติ {pendingCorrections} รายการ · ผลเดิมยังมีผลบังคับจนกว่า
              Owner จะอนุมัติ และเมื่ออนุมัติแล้วงวดนี้ต้องคำนวณ Settlement ใหม่
            </p>
          )}
          {canEnter && draw.status !== "CLOSED" && <div className="result-entry-guide"><span className="result-entry-guide-icon"><DashboardIcon name="edit" /></span><div><strong>กรอกและยืนยันผลรางวัล</strong><small>ตรวจเลขให้ถูกต้องก่อนบันทึก เมื่อกดแล้วผลจะได้รับการยืนยันทันทีโดยไม่ต้องตรวจซ้ำ</small></div><a href="#result-entry-list">กรอกผลด้านล่าง ↓</a></div>}
          {canEnter && editableCount > 0 && draw.status !== "CLOSED" && <GloResultImporter drawId={draw.id} dateOptions={gloDateOptions} />}
          <div className="table-wrap" id="result-entry-list"><table className="result-entry-table">
            <thead>
              <tr>
                <th scope="col">รางวัล</th>
                <th scope="col">ผลที่กรอก</th>
                <th scope="col">สถานะ</th>
                <th scope="col">ผู้บันทึก</th>
                <th scope="col">การจัดการ</th>
              </tr>
            </thead>
            <tbody>
              {prizeTypes.map((pt) => {
                const latest = latestByPrizeType.get(pt.id);
                const approvedResult = approvedByPrizeType.get(pt.id);
                // ล็อกช่องกรอกเมื่อมีผลที่อนุมัติแล้ว แม้ version ล่าสุดจะเป็นคำขอแก้ที่ยังไม่อนุมัติ
                const locked = draw.status === "CLOSED" || approvedResult !== undefined;
                const correctionPending = approvedResult !== undefined && latest?.status === "DRAFT";
                // ความยาวของผลที่ประกาศ ไม่ใช่ความยาวของเลขที่แทง — ต่างกันในรางวัลวิ่ง
                // null = รางวัลวิ่งที่ยังไม่ได้ตั้งค่าใน Rulebook จึงลงผลไม่ได้
                const resultLength = expectedResultLength(pt);
                const valueCount = resultValueCount(pt.code);

                return (
                  <tr key={pt.id}>
                    <td>
                      {pt.code}. {pt.name}
                      <span className="muted">
                        {" "}
                        (แทง {pt.digits} หลัก
                        {resultLength !== null && resultLength !== pt.digits
                          ? ` · ผล ${resultLength} หลัก`
                          : ""}
                        )
                      </span>
                    </td>
                    <td className="number-cell">
                      {correctionPending ? (
                        <>
                          {approvedResult && displayResultValues(approvedResult)}
                          <span className="muted"> → {latest && displayResultValues(latest)}</span>
                        </>
                      ) : (
                        (latest ? displayResultValues(latest) : "-")
                      )}
                    </td>
                    <td>
                      {correctionPending
                        ? "รออนุมัติการแก้ผล"
                        : latest
                          ? (RESULT_STATUS[latest.status] ?? latest.status)
                          : "ยังไม่กรอก"}
                      {latest?.rejectReason != null && (
                        <span className="muted"> · {latest.rejectReason}</span>
                      )}
                    </td>
                    <td className="muted">
                      {latest?.maker.displayName ?? "-"}
                    </td>
                    <td>
                      {canEnter && !locked && resultLength !== null && (
                        <div className={valueCount > 1 ? "result-value-inputs" : undefined}>
                          {Array.from({ length: valueCount }, (_, valueIndex) => (
                            <input
                              key={valueIndex}
                              form={bulkFormId}
                              className="result-bulk-input"
                              data-glo-prize-code={pt.code}
                              data-glo-value-index={valueIndex}
                              name={`result:${pt.id}`}
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={resultLength}
                              defaultValue={latest?.status === "DRAFT" ? storedResultValues(latest)[valueIndex] ?? "" : ""}
                              placeholder={`${MATCH_HINT[pt.matchRule] ?? "เลขที่ออก"} ${valueCount > 1 ? `ช่อง ${valueIndex + 1}` : ""} · ${resultLength} หลัก`}
                              aria-label={`ผลรางวัลที่ ${pt.code}${valueCount > 1 ? ` เลขที่ ${valueIndex + 1}` : ""}`}
                              required
                            />
                          ))}
                        </div>
                      )}
                      {canEnter && !locked && resultLength === null && (
                        <span className="error" role="alert">
                          ยังไม่ได้ตั้งจำนวนหลักของผลรางวัล · ตั้งที่{" "}
                          <Link href="/prize-types">Rulebook</Link> ก่อนลงผล
                        </span>
                      )}
                      {canProposeCorrection &&
                        !correctionPending &&
                        approvedResult !== undefined &&
                        draw.status !== "CLOSED" &&
                        resultLength !== null && (
                          <ProposeCorrectionForm
                            drawId={draw.id}
                            prizeTypeId={pt.id}
                            code={pt.code}
                            currentValues={storedResultValues(approvedResult)}
                            resultLength={resultLength}
                            valueCount={valueCount}
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
          </table></div>
          {canEnter && editableCount > 0 && draw.status !== "CLOSED" && (
            <SaveAllResultsForm drawId={draw.id} formId={bulkFormId} editableCount={editableCount} />
          )}
          </>
        )}

        <h2>สรุปการเงิน</h2>

        {canCalculate && draw.status !== "CLOSED" && approvedCount > 0 && (
          <CalculateForm drawId={draw.id} />
        )}

        {settlementData.settlements.length === 0 ? (
          <p className="muted">ยังไม่ได้คำนวณ</p>
        ) : (
          <>
            <div className="table-wrap"><table>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col" className="num">ยอดขาย</th>
                  <th scope="col" className="num">จ่ายรางวัล</th>
                  <th scope="col" className="num">คอม</th>
                  <th scope="col" className="num">สุทธิ</th>
                  <th scope="col">สถานะ</th>
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
                  </tr>
                ))}
              </tbody>
            </table></div>

            {canCalculate && (
              <p>
                <a href={`/api/draws/${draw.id}/reconciliation`}>
                  ดาวน์โหลดสรุป Settlement (CSV)
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

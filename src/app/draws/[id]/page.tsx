import Link from "next/link";
import { Fragment } from "react";
import { DashboardIcon } from "../../DashboardIcon";
import { notFound, redirect } from "next/navigation";
import { getActor, orgScope } from "@/lib/auth/context";
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
import { RestrictionManager } from "./RestrictionManager";
import { listRestrictions } from "@/lib/draws/restrictions";
import { capLabel, fullNumbersByDraw } from "@/lib/draws/number-cap";
import { compactRate } from "@/lib/bills/betting";
import { prisma } from "@/lib/db";
import { DRAW_DISPLAY_STATUS_LABEL, getDrawDisplayStatus } from "@/lib/draws/display-status";
import { visibleBillNumber } from "@/lib/bills/numbering";
import "./draw-detail.css";

export const dynamic = "force-dynamic";

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

type WinItem = Awaited<ReturnType<typeof listSettlements>>["winningItems"][number];

/** แสดงรายการแรก ๆ ทันที ที่เหลือพับไว้ ไม่ให้ Agent ที่ถูกเยอะดันตารางยาว */
const WINS_PREVIEW = 5;

const MONEY = new Intl.NumberFormat("th-TH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function WinList({ items }: { items: WinItem[] }) {
  return (
    <ul className="settlement-win-list">
      {items.map((item) => (
        <li key={item.id}>
          <span className="settlement-win-prize">{item.prizeType.name}</span>
          <strong className="settlement-win-number">{item.number}</strong>
          <span className="settlement-win-calc">
            ลง {MONEY.format(Number(item.stake))} × {compactRate(item.payoutRateSnapshot)}
            {" = "}
            <b>{MONEY.format(Number(item.payout))}</b>
          </span>
          <Link className="settlement-win-bill" href={`/bills/${item.bill.id}`}>
            {visibleBillNumber(item.bill.drawSequence)}
            {item.bill.title.trim() && ` · ${item.bill.title.trim()}`}
          </Link>
        </li>
      ))}
    </ul>
  );
}

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
  const canManageRestrictions = can(actor.role, "draw.manage");
  const [restrictionRows, restrictionPrizeTypes, capDraw] = canManageRestrictions
    ? await Promise.all([
        listRestrictions(actor, draw.id),
        prisma.prizeType.findMany({
          where: { ...orgScope(actor), isActive: true },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true, digits: true, payoutRate: true },
        }),
        prisma.draw.findFirst({ where: { ...orgScope(actor), id: draw.id }, select: { id: true, numberCap: true } }),
      ])
    : [[], [], null];
  const fullNumberRows = capDraw
    ? (await fullNumbersByDraw(prisma, actor.organizationId, [capDraw])).get(capDraw.id) ?? []
    : [];
  const prizeNameById = new Map(restrictionPrizeTypes.map((prizeType) => [prizeType.id, prizeType.name]));
  const canEnter = can(actor.role, "result.enter");
  const canApproveResult = can(actor.role, "result.approve");
  const canApproveCorrection = can(actor.role, "result.approveCorrection");
  const canProposeCorrection = can(actor.role, "result.proposeCorrection");
  const correctionAppliesImmediately = actor.role === "OWNER" || actor.role === "GODMODE";
  const canCalculate = can(actor.role, "settlement.calculate");
  const canApproveSettlement = can(actor.role, "settlement.approve");
  const canViewAgentProfiles = can(actor.role, "report.viewAllAgents");

  const winsByAgent = new Map<string, WinItem[]>();
  for (const item of settlementData.winningItems) {
    const list = winsByAgent.get(item.bill.agentId) ?? [];
    list.push(item);
    winsByAgent.set(item.bill.agentId, list);
  }

  const approvedCount = approvedByPrizeType.size;
  const displayStatus = getDrawDisplayStatus(draw);
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
        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Draw & Settlement</p><h1 id="draw-heading">{draw.name}</h1><p>บันทึกผลและคำนวณ Settlement จากข้อมูลจริงของงวด</p></div><span className={`status-pill ${displayStatus === "OPEN" ? "success" : displayStatus === "CLOSED" ? "warning" : "info"}`}>{DRAW_DISPLAY_STATUS_LABEL[displayStatus]}</span></header>
        <div className="draw-detail-summary"><div><span>ผลที่อนุมัติแล้ว</span><strong>{approvedCount} / {prizeTypes.length}</strong></div><div><span>Settlement</span><strong>{settlementData.settlements.length}</strong><small>Agent</small></div><div><span>สถานะงวด</span><strong>{DRAW_DISPLAY_STATUS_LABEL[displayStatus]}</strong></div></div>

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
                <th scope="col">ผลเลขรางวัล</th>
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
                            appliesImmediately={correctionAppliesImmediately}
                          />
                        )}
                      {latest?.status === "DRAFT" &&
                        (latest.version === 1 ? canApproveResult : canApproveCorrection) && (
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
                {settlementData.settlements.map((s) => {
                  const wins = winsByAgent.get(s.agentId) ?? [];
                  return (
                  <Fragment key={s.id}>
                  <tr className={wins.length > 0 ? "settlement-row has-wins" : "settlement-row"}>
                    <td>
                      {canViewAgentProfiles ? (
                        <Link className="settlement-agent-link" href={`/agents/${s.agentId}?drawId=${draw.id}`}>
                          <strong>{s.agent.code}</strong>
                          <span>{s.agent.name}</span>
                          <small>ดูยอดขายและบิลของงวดนี้ →</small>
                        </Link>
                      ) : (
                        <>{s.agent.code} {s.agent.name}</>
                      )}
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
                  {wins.length > 0 && (
                    <tr className="settlement-wins-row">
                      <td colSpan={6}>
                        <div className="settlement-wins">
                          <span className="settlement-wins-label">ถูกรางวัล {wins.length} รายการ</span>
                          <WinList items={wins.slice(0, WINS_PREVIEW)} />
                          {wins.length > WINS_PREVIEW && (
                            <details className="settlement-wins-more">
                              <summary>ดูอีก {wins.length - WINS_PREVIEW} รายการ</summary>
                              <WinList items={wins.slice(WINS_PREVIEW)} />
                            </details>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                  );
                })}
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
        {canManageRestrictions && (
          <RestrictionManager
            drawId={draw.id}
            editable={draw.status === "OPEN"}
            prizeTypes={restrictionPrizeTypes.map((prizeType) => ({
              id: prizeType.id,
              code: prizeType.code,
              name: prizeType.name,
              digits: prizeType.digits,
              payoutRate: compactRate(prizeType.payoutRate),
            }))}
            rows={restrictionRows.map((row) => ({
              id: row.id,
              number: row.number,
              kind: row.kind,
              payoutRate: row.payoutRate ? compactRate(row.payoutRate) : null,
              prizeTypeName: row.prizeType.name,
              normalRate: compactRate(row.prizeType.payoutRate),
            }))}
            numberCap={capDraw?.numberCap ? String(Number(capDraw.numberCap)) : ""}
            capLabel={capLabel(capDraw?.numberCap ?? null)}
            fullNumbers={fullNumberRows.map((row) => ({
              key: `${row.prizeTypeId}:${row.number}`,
              prizeTypeName: prizeNameById.get(row.prizeTypeId) ?? "-",
              number: row.number,
              used: MONEY.format(Number(row.used)),
            }))}
          />
        )}
      </section>
    </main>
  );
}

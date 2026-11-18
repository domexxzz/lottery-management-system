import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { getBill } from "@/lib/bills/service";
import { canTransition } from "@/lib/bills/lifecycle";
import { NotFoundError } from "@/lib/errors";
import { ConfirmButton, DeleteBillForm, EditBillForm } from "./BillActions";
import { EvidenceManager } from "./EvidenceManager";
import { SlipDetail } from "./SlipDetail";
import { SlipAllDetail } from "./SlipAllDetail";
import { PlacedBillPanel } from "./PlacedBillPanel";
import "./evidence.css";
import "../slip-board.css";
import { getStorageConfig } from "@/lib/storage/config";
import { listBillAttachments } from "@/lib/evidence/service";
import { BET_STATUS_LABEL, betStatusOf, drawDateLabel, lotteryLabel } from "@/lib/bills/betting";
import { LotteryFlag } from "../ThaiFlag";
import { laoSetPackageLabel } from "@/lib/lao/rules";

export const dynamic = "force-dynamic";

export default async function BillDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string; edit?: string; dup?: string; view?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const { placed, edit, dup, view } = await searchParams;

  let bill;
  try {
    bill = await getBill(actor, id);
  } catch (error) {
    // billScope ทำให้บิลของ Agent รายอื่นหาไม่เจอ จึงตอบ 404 เหมือนไม่มีอยู่จริง
    // ไม่ตอบ 403 เพราะนั่นจะยืนยันว่าบิลเลขนี้มีอยู่
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const canConfirm = canTransition(bill.status, "CONFIRMED") && can(actor.role, "bill.confirm");
  const beforeCutoff = bill.draw.status === "OPEN" && Date.now() < bill.draw.cutoffAt.getTime();
  const editableStatus = bill.status === "CONFIRMED" || bill.status === "DRAFT";
  const canEditBill = beforeCutoff && editableStatus && can(actor.role, "bill.editBeforeCutoff");
  const canDeleteBill = beforeCutoff && editableStatus && can(actor.role, "bill.delete");
  const canDeleteEvidence = can(actor.role, "evidence.delete");

  const evidenceConfig = getStorageConfig();
  // บิลเดียวหลายประเภทหวย: ใบหลักคือส่วนแรก ส่วนอื่นชี้มาที่ใบหลักด้วย slipId
  const primaryId = bill.slipId ?? bill.id;
  const [attachmentDetails, settlement, billHistory, slipParts] = await Promise.all([
    listBillAttachments(actor, bill.id),
    bill.status === "SETTLED"
      ? prisma.settlement.findUnique({ where: { drawId_agentId: { drawId: bill.drawId, agentId: bill.agentId } }, select: { calculatedAt: true } })
      : Promise.resolve(null),
    prisma.auditEvent.findMany({
      where: { organizationId: actor.organizationId, entityType: "Bill", entityId: bill.id, action: { in: ["UPDATE", "DELETE"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, action: true, before: true, after: true, reason: true, createdAt: true, actor: { select: { displayName: true, role: true } } },
    }),
    prisma.bill.findMany({
      where: { organizationId: actor.organizationId, agentId: bill.agentId, OR: [{ id: primaryId }, { slipId: primaryId }] },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        totalStake: true,
        draw: { select: { name: true, drawDate: true, lotteryType: true } },
        _count: { select: { items: true } },
      },
    }),
  ]);
  const isMultiSlip = slipParts.length > 1;
  // บิลหลายหวยเปิดมาที่ "ทั้งหมด" ก่อน ส่วน view=id ใช้ดู/แก้เฉพาะหวยนั้น
  const viewAll = isMultiSlip && (view === undefined || view === "all");
  const detailedParts = viewAll
    ? await Promise.all(slipParts.map((part) => part.id === bill.id ? Promise.resolve(bill) : getBill(actor, part.id)))
    : [];
  const activeParts = slipParts.filter((part) => part.status !== "CANCELLED");
  const slipTotal = activeParts.reduce((sum, part) => sum + Number(part.totalStake), 0);
  const slipItemCount = activeParts.reduce((sum, part) => sum + part._count.items, 0);
  // หลักฐานของบิลหลายประเภทหวยแนบที่ใบหลักใบเดียว
  const isSecondaryPart = bill.slipId !== null;
  const primaryPart = slipParts.find((part) => part.id === primaryId);
  const activeEvidence = bill.attachments.filter((attachment) => attachment.replacedBy === null);
  const hasOrderEvidence = activeEvidence.some(
    (attachment) => attachment.type === "ORDER_EVIDENCE" && attachment.status !== "REJECTED",
  );
  const hasRejectedEvidence = activeEvidence.some((attachment) => attachment.status === "REJECTED");
  const evidenceReady =
    (!evidenceConfig.requireOrderEvidence || hasOrderEvidence) &&
    !activeEvidence.some((attachment) => attachment.status === "REJECTED");
  const evidenceMessage = activeEvidence.some((attachment) => attachment.status === "REJECTED")
    ? "เปลี่ยนหลักฐานที่ถูกตีกลับและส่งตรวจใหม่ก่อนยืนยันบิล"
    : "แนบหลักฐานการสั่งซื้ออย่างน้อย 1 รูปให้สำเร็จก่อนยืนยันบิล";

  const paidAtInput = bill.payment
    ? new Date(bill.payment.paidAt.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16)
    : "";
  const betStatus = betStatusOf(bill);

  return (
    <main className="workspace-page bill-detail-page slip-board-page">
      <section className="slip-detail-page" aria-labelledby="bill-heading">
        {placed === "1" && bill.drawSequence !== null && (
          <PlacedBillPanel
            sequence={bill.drawSequence}
            customer={bill.title}
            itemCount={isMultiSlip ? slipItemCount : bill.items.length}
            totalStake={isMultiSlip ? slipTotal.toFixed(2) : bill.totalStake.toFixed(2)}
            lotteryType={bill.draw.lotteryType}
            parts={isMultiSlip ? activeParts.map((part) => ({
              label: `${lotteryLabel(part.draw.lotteryType)} งวด ${drawDateLabel(part.draw)}`,
              itemCount: part._count.items,
              totalStake: part.totalStake.toFixed(2),
            })) : []}
            draftScope={`${actor.userId}:slip`}
            duplicate={dup === "1"}
          />
        )}
        <header className="bill-detail-toolbar">
          <Link href="/bills" className="slip-outline-button bill-detail-back">← กลับไปหน้าประวัติ</Link>
          <div className="bill-detail-title">
            <nav className="slip-breadcrumb" aria-label="ตำแหน่งหน้า"><Link href="/bills">ประวัติรายการ</Link><span aria-hidden="true">/</span><span>รายละเอียดบิล</span></nav>
            <h1 id="bill-heading">รายละเอียดบิล {bill.drawSequence === null ? "ร่าง" : bill.drawSequence}{isMultiSlip ? ` · ${slipParts.length} ประเภทหวย` : ""} <span className={`slip-status slip-status-${betStatus.toLowerCase()}`}>{BET_STATUS_LABEL[betStatus]}</span></h1>
          </div>
          <nav className="bill-detail-tools" aria-label="เครื่องมือบิล">
            {canEditBill && <Link href={`/bills/${bill.id}?view=${bill.id}&edit=1#bill-edit`} className="slip-primary-button">แก้ไขบิล</Link>}
            <Link href={`/bills/${bill.id}/print`} target="_blank" className="slip-outline-button">พิมพ์บิล</Link>
            <Link href={`/bills/${bill.id}/print?format=slip`} target="_blank" className="slip-outline-button">พิมพ์สลิป</Link>
          </nav>
        </header>

        {isMultiSlip && (
          <nav className="bill-slip-parts" aria-label="ประเภทหวยในบิลนี้">
            <p>
              <strong>บิล {bill.drawSequence ?? "ร่าง"} มี {slipParts.length} ประเภทหวย</strong>
              <span>รวม {slipItemCount.toLocaleString("th-TH")} รายการ · {slipTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท · เลือกการ์ดเพื่อดูรายการของแต่ละหวย</span>
            </p>
            <div>
              <Link
                href={`/bills/${primaryId}?view=all#bill-items`}
                aria-current={viewAll ? "page" : undefined}
                className="is-all"
              >
                <span className="bill-slip-all-icon" aria-hidden="true">≡</span>
                <span>
                  <strong>ทั้งหมด</strong>
                  <small>{slipItemCount} รายการ · {slipTotal.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท</small>
                </span>
              </Link>
              {slipParts.map((part) => (
                <Link
                  key={part.id}
                  href={`/bills/${part.id}?view=${part.id}#bill-items`}
                  aria-current={!viewAll && part.id === bill.id ? "page" : undefined}
                  className={`is-${part.draw.lotteryType.toLowerCase()}${part.status === "CANCELLED" ? " is-cancelled" : ""}`}
                >
                  <LotteryFlag lotteryType={part.draw.lotteryType} />
                  <span>
                    <strong>{lotteryLabel(part.draw.lotteryType)}</strong>
                    <small>งวด {drawDateLabel(part.draw)} · {part._count.items} รายการ · {Number(part.totalStake).toLocaleString("th-TH")} บาท{part.status === "CANCELLED" ? " · ลบแล้ว" : ""}</small>
                  </span>
                </Link>
              ))}
            </div>
          </nav>
        )}

        {bill.status === "CANCELLED" && (
          <p className="slip-alert is-danger" role="status">ลบแล้วโดย {bill.cancelledBy?.displayName ?? "-"}{bill.cancelledAt ? ` · ${new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(bill.cancelledAt)}` : ""}</p>
        )}

        {viewAll ? (
          <SlipAllDetail parts={detailedParts} />
        ) : (
        <SlipDetail
          bill={bill}
          settledAt={settlement?.calculatedAt ?? null}
          showDrawLink={actor.role !== "AGENT"}
          beforeItems={(
            <div className="bill-change-zone">
              {canEditBill && (
                <details id="bill-edit" className="slip-panel bill-edit-panel" open={edit === "1"}>
                  <summary><span>แก้ไขเลขและยอดเดิมพัน</span><small>ใช้ได้เฉพาะก่อนปิดรับ · มีผลทันที</small></summary>
                  <EditBillForm
                    billId={bill.id}
                    title={bill.title}
                    items={bill.items.map((item) => ({
                      id: item.id,
                      prizeTypeId: item.prizeTypeId,
                      prizeTypeName: item.prizeType.name,
                      number: item.number,
                      stake: item.stake.toFixed(2),
                      digits: item.prizeType.digits,
                      packageLabel: bill.draw.lotteryType === "LAO_SET" ? laoSetPackageLabel(item.stake) : null,
                      lockedStake: bill.draw.lotteryType === "LAO_SET",
                    }))}
                  />
                </details>
              )}
              {billHistory.length > 0 && (
                <section className="slip-panel bill-change-history" aria-labelledby="bill-history-heading">
                  <header className="slip-panel-head"><h2 id="bill-history-heading">ประวัติการแก้ไขบิล</h2><span>{billHistory.length} ครั้ง</span></header>
                  <ol>
                    {billHistory.map((event) => {
                      const before = event.before as { title?: string; totalStake?: string; items?: Array<{ number?: string; stake?: string; prizeTypeName?: string }> } | null;
                      const after = event.after as { title?: string; totalStake?: string; items?: Array<{ number?: string; stake?: string; prizeTypeName?: string }>; status?: string } | null;
                      const changes: string[] = [];
                      if (event.action === "DELETE") changes.push("ลบบิลแล้ว และนำออกจากการคำนวณ");
                      if (before?.title !== undefined && after?.title !== undefined && before.title !== after.title) changes.push(`ชื่อลูกค้า “${before.title}” → “${after.title}”`);
                      const count = Math.max(before?.items?.length ?? 0, after?.items?.length ?? 0);
                      for (let index = 0; index < count; index += 1) {
                        const oldItem = before?.items?.[index];
                        const newItem = after?.items?.[index];
                        if (oldItem && newItem) {
                          const prefix = `รายการ ${index + 1} ${newItem.prizeTypeName ?? oldItem.prizeTypeName ?? ""}`.trim();
                          if (oldItem.number !== newItem.number) changes.push(`${prefix}: เลข ${oldItem.number} → ${newItem.number}`);
                          if (oldItem.stake !== newItem.stake) changes.push(`${prefix}: เดิมพัน ${oldItem.stake} → ${newItem.stake} บาท`);
                        }
                      }
                      if (changes.length === 0) changes.push(event.reason ?? "ปรับปรุงข้อมูลบิล");
                      return (
                        <li key={event.id} className={event.action === "DELETE" ? "is-delete" : ""}>
                          <span className="bill-history-icon" aria-hidden="true">{event.action === "DELETE" ? "×" : "✎"}</span>
                          <div><strong>{event.action === "DELETE" ? "ลบบิล" : "แก้ไขบิล"}</strong>{changes.map((change) => <p key={change}>{change}</p>)}</div>
                          <div className="bill-history-who"><b>{event.actor?.displayName ?? "ระบบ"}</b><small>{new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }).format(event.createdAt)}</small></div>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}
            </div>
          )}
        />
        )}

        {/* ส่วนรองพับไว้ เปิดอัตโนมัติเฉพาะตอนที่ต้องลงมือ เช่นบิลร่างหรือหลักฐานถูกตีกลับ */}
        {isSecondaryPart ? (
          <p className="slip-panel bill-slip-evidence-note">
            หลักฐานของบิลนี้แนบรวมไว้ที่ส่วน
            {" "}<Link href={`/bills/${primaryId}#bill-evidence`}>{primaryPart ? lotteryLabel(primaryPart.draw.lotteryType) : "แรกของบิล"} →</Link>
          </p>
        ) : (
        <details className="slip-panel slip-collapse" open={bill.status === "DRAFT" || hasRejectedEvidence || placed === "1"}>
          <summary>
            <span>หลักฐานการสั่งซื้อและการชำระเงิน</span>
            <small>{activeEvidence.length > 0 ? `${activeEvidence.length} ไฟล์` : "ยังไม่มีไฟล์"}{hasRejectedEvidence ? " · มีไฟล์ถูกตีกลับ" : ""}</small>
          </summary>
          <EvidenceManager
            billId={bill.id}
            billStatus={bill.status}
            canUpload={can(actor.role, "evidence.upload")}
            canDelete={canDeleteEvidence}
            maxFiles={evidenceConfig.maxFilesPerBill}
            maxFileSizeMb={Math.round(evidenceConfig.maxFileSizeBytes / 1024 / 1024)}
            billTotalStake={bill.totalStake.toFixed(2)}
            initialItems={attachmentDetails.map((attachment) => ({
              id: attachment.id,
              type: attachment.type,
              originalName: attachment.originalName,
              fileSize: attachment.fileSize,
              status: attachment.status,
              rejectionReason: attachment.rejectionReason,
              createdAt: attachment.createdAt,
              uploadedBy: attachment.uploadedBy ?? "ไม่ทราบผู้แนบ",
              verifiedBy: attachment.verifiedBy,
              verifiedAt: attachment.verifiedAt,
              replacesId: attachment.replacesId,
              replacedById: attachment.replacedById,
              duplicateCount: attachment.duplicateCount,
            }))}
            initialPayment={bill.payment ? {
              amount: bill.payment.amount.toFixed(2),
              paidAt: paidAtInput,
              paymentMethod: bill.payment.paymentMethod,
              bankName: bill.payment.bankName ?? "",
              note: bill.payment.note ?? "",
              verificationStatus: bill.payment.verificationStatus,
            } : null}
          />
        </details>
        )}

        {(canConfirm || canDeleteBill) && (
          <details className="slip-panel slip-collapse" open={canConfirm}>
            <summary>
              <span>จัดการบิล</span>
              <small>{canConfirm ? "ยืนยันบิลร่าง" : "ลบบิลก่อนปิดรับ"}</small>
            </summary>
            <div className="slip-collapse-body">
              {canConfirm && <ConfirmButton billId={bill.id} evidenceReady={evidenceReady} evidenceMessage={evidenceMessage} />}
              {canDeleteBill && <DeleteBillForm billId={bill.id} billLabel={`บิล ${bill.drawSequence ?? "ร่าง"}`} attachmentCount={activeEvidence.length} />}
            </div>
          </details>
        )}
      </section>
    </main>
  );
}

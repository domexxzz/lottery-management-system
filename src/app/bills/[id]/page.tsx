import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { prisma } from "@/lib/db";
import { can } from "@/lib/auth/permissions";
import { getBill } from "@/lib/bills/service";
import { canTransition } from "@/lib/bills/lifecycle";
import { NotFoundError } from "@/lib/errors";
import { CancelForm, ConfirmButton, DeleteBillForm, RequestCancelForm } from "./BillActions";
import { EvidenceManager } from "./EvidenceManager";
import { SlipDetail } from "./SlipDetail";
import "./evidence.css";
import "../slip-board.css";
import { getStorageConfig } from "@/lib/storage/config";
import { listBillAttachments } from "@/lib/evidence/service";
import { BET_STATUS_LABEL, betStatusOf } from "@/lib/bills/betting";

export const dynamic = "force-dynamic";

export default async function BillDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string }>;
}) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const { id } = await params;
  const { placed } = await searchParams;

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
  const afterCutoff = bill.status === "LOCKED";

  // หลังปิดรับ ผู้อนุมัติเท่านั้นที่ยกเลิกได้ และต้องไม่ใช่คนที่เสนอเอง
  const canCancel =
    canTransition(bill.status, "CANCELLED") &&
    (afterCutoff
      ? can(actor.role, "bill.approveChangeAfterCutoff") &&
        bill.cancelRequestedById !== actor.userId
      : can(actor.role, "bill.editBeforeCutoff"));

  const canRequestCancel =
    afterCutoff &&
    bill.cancelRequestedById === null &&
    can(actor.role, "bill.proposeChangeAfterCutoff") &&
    !can(actor.role, "bill.approveChangeAfterCutoff");
  const canDeleteBill = can(actor.role, "bill.delete");
  const canDeleteEvidence = can(actor.role, "evidence.delete");

  const evidenceConfig = getStorageConfig();
  const [attachmentDetails, settlement] = await Promise.all([
    listBillAttachments(actor, bill.id),
    bill.status === "SETTLED"
      ? prisma.settlement.findUnique({ where: { drawId_agentId: { drawId: bill.drawId, agentId: bill.agentId } }, select: { calculatedAt: true } })
      : Promise.resolve(null),
  ]);
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
          <p className="slip-placed" role="status">บันทึกบิลสำเร็จ · บิล {bill.drawSequence} · แนบหลักฐานได้ในส่วนด้านล่างจนกว่าจะปิดรับ</p>
        )}
        <header className="bill-detail-toolbar">
          <Link href="/bills" className="slip-outline-button bill-detail-back">← กลับไปหน้าประวัติ</Link>
          <div className="bill-detail-title">
            <nav className="slip-breadcrumb" aria-label="ตำแหน่งหน้า"><Link href="/bills">ประวัติรายการ</Link><span aria-hidden="true">/</span><span>รายละเอียดบิล</span></nav>
            <h1 id="bill-heading">รายละเอียดบิล {bill.drawSequence === null ? "ร่าง" : bill.drawSequence} <span className={`slip-status slip-status-${betStatus.toLowerCase()}`}>{BET_STATUS_LABEL[betStatus]}</span></h1>
          </div>
          <nav className="bill-detail-tools" aria-label="เครื่องมือบิล">
            <Link href={`/bills/${bill.id}/print`} target="_blank" className="slip-outline-button">พิมพ์บิล</Link>
            <Link href={`/bills/${bill.id}/print?format=slip`} target="_blank" className="slip-outline-button">พิมพ์สลิป</Link>
          </nav>
        </header>

        {bill.status === "CANCELLED" && (
          <p className="slip-alert is-danger" role="status">ยกเลิกโดย {bill.cancelledBy?.displayName ?? "-"} · เหตุผล: {bill.cancelReason}</p>
        )}
        {bill.cancelRequestedById !== null && bill.status !== "CANCELLED" && (
          <p className="slip-alert" role="status">มีคำขอยกเลิกจาก {bill.cancelRequestedBy?.displayName ?? "-"} · เหตุผล: {bill.cancelRequestReason} · รอผู้มีอำนาจอนุมัติ</p>
        )}

        <SlipDetail bill={bill} settledAt={settlement?.calculatedAt ?? null} showDrawLink={actor.role !== "AGENT"} />

        {/* ส่วนรองพับไว้ เปิดอัตโนมัติเฉพาะตอนที่ต้องลงมือ เช่นบิลร่างหรือหลักฐานถูกตีกลับ */}
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

        {(canConfirm || canRequestCancel || canCancel || canDeleteBill) && (
          <details className="slip-panel slip-collapse" open={canConfirm}>
            <summary>
              <span>จัดการบิล</span>
              <small>{canConfirm ? "ยืนยันบิลร่าง" : "ยกเลิกหรือขอยกเลิกบิล"}</small>
            </summary>
            <div className="slip-collapse-body">
              {canConfirm && <ConfirmButton billId={bill.id} evidenceReady={evidenceReady} evidenceMessage={evidenceMessage} />}
              {canRequestCancel && <RequestCancelForm billId={bill.id} />}
              {canCancel && <CancelForm billId={bill.id} label={afterCutoff ? "อนุมัติและยกเลิกบิล" : "ยกเลิกบิล"} />}
              {canDeleteBill && <DeleteBillForm billId={bill.id} billLabel={`บิล ${bill.drawSequence ?? "ร่าง"}`} attachmentCount={activeEvidence.length} />}
            </div>
          </details>
        )}
      </section>
    </main>
  );
}

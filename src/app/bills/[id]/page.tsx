import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { getBill } from "@/lib/bills/service";
import { canTransition, statusLabel } from "@/lib/bills/lifecycle";
import { NotFoundError } from "@/lib/errors";
import { customerProfileKey } from "@/lib/customers/profile-key";
import { DashboardIcon as Icon } from "@/app/DashboardIcon";
import { CancelForm, ConfirmButton, RequestCancelForm } from "./BillActions";
import { EvidenceManager } from "./EvidenceManager";
import "./evidence.css";
import { getStorageConfig } from "@/lib/storage/config";
import { listBillAttachments } from "@/lib/evidence/service";

export const dynamic = "force-dynamic";

const BANGKOK = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export default async function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) redirect("/login");

  const { id } = await params;

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

  const evidenceConfig = getStorageConfig();
  const attachmentDetails = await listBillAttachments(actor, bill.id);
  const activeEvidence = bill.attachments.filter((attachment) => attachment.replacedBy === null);
  const hasOrderEvidence = activeEvidence.some(
    (attachment) => attachment.type === "ORDER_EVIDENCE" && attachment.status !== "REJECTED",
  );
  const evidenceReady =
    (!evidenceConfig.requireOrderEvidence || hasOrderEvidence) &&
    !activeEvidence.some((attachment) => attachment.status === "REJECTED");
  const evidenceMessage = activeEvidence.some((attachment) => attachment.status === "REJECTED")
    ? "เปลี่ยนหลักฐานที่ถูกตีกลับและส่งตรวจใหม่ก่อนยืนยันบิล"
    : "แนบหลักฐานการสั่งซื้ออย่างน้อย 1 รูปให้สำเร็จก่อนยืนยันบิล";

  const paidAtInput = bill.payment
    ? new Date(bill.payment.paidAt.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16)
    : "";

  return (
    <main className="workspace-page bill-detail-page">
      <section className="card workspace-card" aria-labelledby="bill-heading">
        <p>
          <Link href="/bills">← กลับไปรายการบิล</Link>
        </p>

        <header className="page-hero"><div className="page-hero-copy"><p className="page-eyebrow">Bill Detail</p><h1 id="bill-heading">{bill.title}</h1><p>ตรวจสอบรายการ ยอดเดิมพัน และประวัติการยืนยันบิล</p></div><span className={`status-pill ${bill.status === "CANCELLED" ? "danger" : bill.status === "SETTLED" ? "success" : bill.status === "DRAFT" ? "warning" : "info"}`}>{statusLabel(bill.status)}</span></header>
        <p className="muted">
          เลขบิล {bill.billNumber ?? "ยังไม่ออกเลข (ร่าง)"} · สถานะ {statusLabel(bill.status)} ·
          งวด {bill.draw.name} · Agent {bill.agent.code} {bill.agent.name}
        </p>
        <p className="muted">
          สร้างโดย {bill.createdBy.displayName} · ปิดรับ {BANGKOK.format(bill.draw.cutoffAt)}
          {bill.confirmedAt !== null && ` · ยืนยันเมื่อ ${BANGKOK.format(bill.confirmedAt)}`}
        </p>
        {bill.status === "CANCELLED" && (
          <p className="error">
            ยกเลิกโดย {bill.cancelledBy?.displayName ?? "-"} · เหตุผล: {bill.cancelReason}
          </p>
        )}

        <section className="bill-items-panel" id="bill-items" aria-labelledby="bill-items-heading">
          <header>
            <div><p>Bill Items</p><h2 id="bill-items-heading">รายการเลขของลูกค้า</h2></div>
            <div className="bill-items-summary"><span>{bill.items.length} รายการ</span><strong>{bill.totalStake.toFixed(2)} บาท</strong></div>
          </header>
        <div className="table-wrap"><table>
          <thead>
            <tr>
              <th scope="col">ประเภทรางวัล</th>
              <th scope="col">เลข</th>
              <th scope="col">ยอดเดิมพัน</th>
              <th scope="col">อัตราจ่าย ณ เวลายืนยัน</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.prizeType.code}. {item.prizeType.name}
                </td>
                <td><strong className="bill-purchased-number">{item.number}</strong></td>
                <td className="num"><strong>{item.stake.toFixed(2)}</strong></td>
                <td>
                  {bill.status === "DRAFT" ? (
                    <span className="muted">ยังไม่ล็อก</span>
                  ) : (
                    item.payoutRateSnapshot.toFixed(4)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                ยอดรวม
              </th>
              <td>
                <strong>{bill.totalStake.toFixed(2)}</strong>
              </td>
              <td />
            </tr>
          </tfoot>
        </table></div>
        </section>

        <Link className="customer-profile-link" href={`/customers/${customerProfileKey(bill.title)}`}>
          <span><Icon name="agent" /></span>
          <div><strong>ดูโปรไฟล์ลูกค้า</strong><small>ประวัติการซื้อ เลขที่ซื้อบ่อย และรางวัลที่ได้รับ</small></div>
          <b aria-hidden="true">→</b>
        </Link>

        <EvidenceManager
          billId={bill.id}
          billStatus={bill.status}
          canUpload={can(actor.role, "evidence.upload")}
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

        <p>
          <Link href={`/bills/${bill.id}/print`} target="_blank">
            พิมพ์แบบ A4
          </Link>
          {" · "}
          <Link href={`/bills/${bill.id}/print?format=slip`} target="_blank">
            พิมพ์แบบสลิป
          </Link>
        </p>

        {bill.cancelRequestedById !== null && bill.status !== "CANCELLED" && (
          <p role="status">
            มีคำขอยกเลิกจาก {bill.cancelRequestedBy?.displayName ?? "-"} · เหตุผล:{" "}
            {bill.cancelRequestReason} · รอผู้มีอำนาจอนุมัติ
          </p>
        )}

        {canConfirm && <ConfirmButton billId={bill.id} evidenceReady={evidenceReady} evidenceMessage={evidenceMessage} />}
        {canRequestCancel && <RequestCancelForm billId={bill.id} />}
        {canCancel && (
          <CancelForm
            billId={bill.id}
            label={afterCutoff ? "อนุมัติและยกเลิกบิล" : "ยกเลิกบิล"}
          />
        )}
      </section>
    </main>
  );
}

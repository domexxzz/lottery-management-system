import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getActor } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { getBill } from "@/lib/bills/service";
import { canTransition, statusLabel } from "@/lib/bills/lifecycle";
import { NotFoundError } from "@/lib/errors";
import { CancelForm, ConfirmButton } from "./BillActions";

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
  const canCancel =
    canTransition(bill.status, "CANCELLED") &&
    (bill.status === "LOCKED"
      ? can(actor.role, "bill.approveChangeAfterCutoff")
      : can(actor.role, "bill.editBeforeCutoff"));

  return (
    <main>
      <section className="card" aria-labelledby="bill-heading">
        <p>
          <Link href="/bills">← กลับไปรายการบิล</Link>
        </p>

        <h1 id="bill-heading">{bill.title}</h1>
        <p className="muted">
          เลขบิล {bill.billNumber ?? "ยังไม่ออกเลข (ร่าง)"} · สถานะ {statusLabel(bill.status)} ·
          รอบ {bill.draw.name} · Agent {bill.agent.code} {bill.agent.name}
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

        <h2>รายการ</h2>
        <table>
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
                <td>{item.number}</td>
                <td>{item.stake.toFixed(2)}</td>
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
        </table>

        {canConfirm && <ConfirmButton billId={bill.id} />}
        {canCancel && <CancelForm billId={bill.id} />}
      </section>
    </main>
  );
}
